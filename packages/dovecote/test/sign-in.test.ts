import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { describeBrowser, localPath } from '../src/auth/sign-in.ts'
import { loadConfig } from '../src/config.ts'
import { SESSION_COOKIE } from '../src/http/authenticate.ts'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import { type FakeIssuer, makeFakeIssuer } from './fake-identity-issuer.ts'
import { type TestServer, startTestServer } from './harness.ts'

const CLIENT_ID = 'homingbird-client'

let server: TestServer
let closed: TestServer | undefined
afterEach(async () => {
  if (server !== closed) await server.close()
  closed = server
})

const withIssuer = async (issuer: FakeIssuer, overrides: Record<string, string> = {}) => {
  server = await startTestServer(
    {
      HB_DEV_LOGIN: '0',
      HB_OIDC_ISSUER: issuer.issuer,
      HB_OIDC_CLIENT_ID: CLIENT_ID,
      HB_OIDC_CLIENT_SECRET: 'secret',
      HB_ADMIN_EMAILS: 'ana@example.com',
      ...overrides,
    },
    { fetch: issuer.fetch },
  )
  return server
}

const claimsFor = (issuer: FakeIssuer, nonce: string, overrides: Record<string, unknown> = {}) => ({
  iss: issuer.issuer,
  aud: CLIENT_ID,
  sub: 'subject-1',
  exp: Math.floor(server.clock.now() / 1000) + 300,
  iat: Math.floor(server.clock.now() / 1000),
  nonce,
  email: 'ana@example.com',
  email_verified: true,
  name: 'Ana',
  hd: 'example.com',
  ...overrides,
})

const attempt = async (issuer: FakeIssuer, returnTo?: string) => {
  const started = await server.request(
    'GET',
    `/auth/login${returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ''}`,
  )
  const authorization = new URL(started.headers.location!)
  const state = authorization.searchParams.get('state')!
  const code = Buffer.from(authorization.searchParams.get('nonce')!).toString('base64url')
  const finished = await server.request('GET', `/auth/callback?${new URLSearchParams({ code, state })}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36' },
  })
  return { authorization, state, code, finished }
}

const signInAs = async (issuer: FakeIssuer, email: string, sub: string) => {
  issuer.nextToken = ({ nonce }) => issuer.signToken(claimsFor(issuer, nonce, { email, sub, name: email }))
  const cookie = (await attempt(issuer)).finished.headers['set-cookie']!.split(';')[0]!
  return (await server.request('GET', '/api/v1/me', { headers: { cookie } })).json.member
}

const refusalOf = (finished: { headers: Readonly<Record<string, string>> }): string =>
  new URLSearchParams(finished.headers.location!.split('?')[1]).get('reason') ?? ''

describe('signing in through an OpenID Connect provider', () => {
  it('sends the browser to the provider with PKCE, state and nonce', async () => {
    const issuer = makeFakeIssuer()
    await withIssuer(issuer)
    issuer.nextToken = ({ nonce }) => issuer.signToken(claimsFor(issuer, nonce))
    const { authorization } = await attempt(issuer)
    expect(authorization.origin + authorization.pathname).toBe('https://accounts.google.com/authorize')
    expect(Object.fromEntries(authorization.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: 'http://localhost:8080/auth/callback',
      scope: 'openid email profile',
      code_challenge_method: 'S256',
    })
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it.each(['RS256', 'ES256'] as const)(
    'accepts a valid %s ID token and starts a session',
    async (algorithm) => {
      const issuer = makeFakeIssuer()
      await withIssuer(issuer)
      issuer.nextToken = ({ nonce }) => issuer.signToken(claimsFor(issuer, nonce), { algorithm })
      const { finished } = await attempt(issuer, '/#/c/conv_1')
      expect(finished.status).toBe(302)
      expect(finished.headers.location).toBe('/#/c/conv_1')
      const cookie = finished.headers['set-cookie']!
      expect(cookie).toMatch(
        new RegExp(`^${SESSION_COOKIE}=hbh_[A-Za-z0-9_-]+; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000$`),
      )
      const me = await server.request('GET', '/api/v1/me', { headers: { cookie: cookie.split(';')[0]! } })
      expect(me.json.member).toMatchObject({ email: 'ana@example.com', name: 'Ana', role: 'admin' })
      expect(me.json.credential).toMatchObject({ kind: 'human', name: 'Chrome on macOS' })
    },
  )

  it.each([
    ['a tampered signature', {}, { tamper: true }, /signature/],
    ['an unknown signing key', {}, { keyId: 'rotated-away' }, /unknown key/],
    ['another issuer', { iss: 'https://evil.example' }, {}, /issuer/],
    ['another audience', { aud: 'someone-else' }, {}, /another application/],
    ['a nonce from another sign-in', { nonce: 'stale' }, {}, /does not belong/],
    ['an expired token', { exp: 1 }, {}, /expired/],
    ['a token without an issue time', { iat: undefined }, {}, /issued in the future/],
    ['a token issued in the future', { iat: 'later' }, {}, /issued in the future/],
    ['a token not valid yet', { nbf: 'later' }, {}, /not valid yet/],
    ['no subject', { sub: '' }, {}, /subject/],
    ['an unverified email', { email_verified: false }, {}, /not been verified/],
    [
      'a domain that is not allowed',
      { email: 'ana@other.org', hd: 'other.org' },
      {},
      /other\.org are not allowed/,
    ],
    ['a personal account using an allowed address', { hd: undefined }, {}, /organization account/],
  ])('refuses %s', async (_, claims, signing, reason) => {
    const issuer = makeFakeIssuer()
    await withIssuer(issuer)
    const later = Math.floor(server.clock.now() / 1000) + 120
    const timed = Object.fromEntries(
      Object.entries(claims).map(([name, value]) => [name, value === 'later' ? later : value]),
    )
    issuer.nextToken = ({ nonce }) => issuer.signToken(claimsFor(issuer, nonce, timed), signing)
    const { finished } = await attempt(issuer)
    expect(finished.headers['set-cookie']).toBeUndefined()
    expect(finished.headers.location).toMatch(/^\/#\/signed-out\?reason=/)
    expect(refusalOf(finished)).toMatch(reason)
  })

  it('accepts issue and not-before times within the clock-skew allowance', async () => {
    const issuer = makeFakeIssuer()
    await withIssuer(issuer)
    const soon = Math.floor(server.clock.now() / 1000) + 50
    issuer.nextToken = ({ nonce }) => issuer.signToken(claimsFor(issuer, nonce, { iat: soon, nbf: soon }))
    expect((await attempt(issuer)).finished.headers['set-cookie']).toBeDefined()
  })

  it('refuses every redirect when fetching discovery, the token and the keys', async () => {
    const issuer = makeFakeIssuer()
    await withIssuer(issuer)
    issuer.nextToken = ({ nonce }) => issuer.signToken(claimsFor(issuer, nonce))
    await attempt(issuer)
    expect(issuer.redirectModes).toHaveLength(3)
    expect(new Set(issuer.redirectModes)).toEqual(new Set(['error']))
  })

  it.each([
    ['an issuer other than the configured one', { issuer: 'https://evil.example' }, /names the issuer/],
    [
      'a token endpoint that is not https',
      { token_endpoint: 'http://accounts.google.com/token' },
      /token_endpoint must be an https URL/,
    ],
    [
      'a token endpoint on a private address',
      { token_endpoint: 'https://10.0.0.5/token' },
      /token_endpoint must name a public host/,
    ],
    [
      'keys on a local name',
      { jwks_uri: 'https://metadata.localhost/keys' },
      /jwks_uri must name a public host/,
    ],
    [
      'an authorization endpoint that is not a URL',
      { authorization_endpoint: 42 },
      /authorization_endpoint is not a URL/,
    ],
    [
      'an endpoint carrying credentials',
      { token_endpoint: 'https://user:pass@accounts.google.com/token' },
      /credentials/,
    ],
  ])(
    'makes sign-in unavailable for a discovery document with %s, and sends nothing',
    async (_, discovery, reason) => {
      const issuer = makeFakeIssuer()
      await withIssuer(issuer, { HB_OIDC_ISSUER: `${issuer.issuer}/`, HB_LOGS: 'operational=debug' })
      issuer.discovery = discovery
      const started = await server.request('GET', '/auth/login')
      expect(refusalOf(started)).toMatch(/Sign-in is unavailable/)
      expect(refusalOf(started)).toMatch(reason)
      const logged = server.logged.map((line) => JSON.parse(line))
      expect(logged.map((line) => line.eventName)).toContain('sign_in.provider_failed')
      expect(
        logged.some((line) => line.eventName === 'defect.detail' && reason.test(line.attributes.detail)),
      ).toBe(true)
      expect(issuer.requests).toEqual([`${issuer.issuer}/.well-known/openid-configuration`])
    },
  )

  it('makes sign-in unavailable when the discovery document redirects', async () => {
    const issuer = makeFakeIssuer()
    await withIssuer(issuer)
    issuer.redirectsDiscovery = true
    expect(refusalOf(await server.request('GET', '/auth/login'))).toMatch(/could not be reached/)
    expect(issuer.requests).toHaveLength(1)
  })

  it('refuses a configured issuer that is not https before fetching anything', async () => {
    const issuer = makeFakeIssuer('http://idp.example.com')
    await withIssuer(issuer)
    expect(refusalOf(await server.request('GET', '/auth/login'))).toMatch(
      /HB_OIDC_ISSUER must be an https URL/,
    )
    expect(issuer.requests).toEqual([])
  })

  it('allows a loopback provider over http when the server itself runs on loopback', async () => {
    const issuer = makeFakeIssuer('http://127.0.0.1:9999')
    await withIssuer(issuer)
    issuer.nextToken = ({ nonce }) => issuer.signToken(claimsFor(issuer, nonce, { hd: undefined }))
    expect((await attempt(issuer)).finished.headers['set-cookie']).toBeDefined()
  })

  it('refuses a malformed token and an unsupported algorithm', async () => {
    const issuer = makeFakeIssuer()
    await withIssuer(issuer)
    issuer.nextToken = () => 'not-a-jwt'
    expect(refusalOf((await attempt(issuer)).finished)).toMatch(/malformed/)
    issuer.nextToken = () => `${Buffer.from('{"alg":"none"}').toString('base64url')}.e30.x`
    expect(refusalOf((await attempt(issuer)).finished)).toMatch(/unsupported signature/)
  })

  it('does not require a hosted domain from a provider that is not Google', async () => {
    const issuer = makeFakeIssuer('https://login.example-idp.com')
    await withIssuer(issuer)
    issuer.nextToken = ({ nonce }) =>
      issuer.signToken(claimsFor(issuer, nonce, { hd: undefined, aud: [CLIENT_ID, 'other'] }))
    expect((await attempt(issuer)).finished.headers['set-cookie']).toBeDefined()
  })

  it('uses a sign-in attempt once and lets it expire', async () => {
    const issuer = makeFakeIssuer()
    await withIssuer(issuer)
    issuer.nextToken = ({ nonce }) => issuer.signToken(claimsFor(issuer, nonce))
    const { state, code } = await attempt(issuer)
    const replay = await server.request('GET', `/auth/callback?${new URLSearchParams({ code, state })}`)
    expect(refusalOf(replay)).toMatch(/expired/)
    const started = await server.request('GET', '/auth/login')
    await server.clock.advance(10 * 60_000)
    const late = await server.request(
      'GET',
      `/auth/callback?state=${new URL(started.headers.location!).searchParams.get('state')}&code=x`,
    )
    expect(refusalOf(late)).toMatch(/expired/)
    expect(refusalOf(await server.request('GET', '/auth/callback'))).toMatch(/expired/)
  })

  it('reports an unreachable provider instead of failing', async () => {
    const issuer = makeFakeIssuer()
    await withIssuer(issuer)
    issuer.unreachable = true
    const started = await server.request('GET', '/auth/login')
    expect(refusalOf(started)).toMatch(/could not be reached/)
  })

  it('keeps the same member across sign-ins, by subject or by email', async () => {
    const issuer = makeFakeIssuer()
    await withIssuer(issuer)
    const first = await signInAs(issuer, 'ben@example.com', 's-ben')
    expect((await signInAs(issuer, 'ben@example.com', 's-ben')).id).toBe(first.id)
    expect((await signInAs(issuer, 'ben.renamed@example.com', 's-ben')).id).toBe(first.id)
    expect((await signInAs(issuer, 'ben.renamed@example.com', 's-ben-reissued')).id).toBe(first.id)
  })

  it('makes nobody an administrator implicitly: only the listed emails, at creation or on a later sign-in', async () => {
    const issuer = makeFakeIssuer()
    await withIssuer(issuer, { HB_ADMIN_EMAILS: 'Cy@Example.com' })
    const first = await signInAs(issuer, 'ana@example.com', 's-ana')
    const listed = await signInAs(issuer, 'cy@example.com', 's-cy')
    expect([first.role, listed.role]).toEqual(['member', 'admin'])
    await T.runPromise(run(sql`UPDATE members SET role = 'member' WHERE id = ${listed.id}`), server.env)
    expect((await signInAs(issuer, 'cy@example.com', 's-cy')).role).toBe('admin')
    expect((await signInAs(issuer, 'ana@example.com', 's-ana')).role).toBe('member')
  })
})

describe('development login', () => {
  it('accepts any address when no domain is allowed, and only the allowed domains otherwise', async () => {
    server = await startTestServer({ HB_ALLOWED_DOMAINS: '' })
    expect((await server.signIn('anyone@anywhere.test')).me.member.email).toBe('anyone@anywhere.test')
    await server.close()
    server = await startTestServer({ HB_ALLOWED_DOMAINS: 'example.com' })
    await expect(server.signIn('anyone@anywhere.test')).rejects.toThrow(/sign-in refused/)
  })

  it.each(['README.md', 'docs/deployment.md'])(
    'starts from the development command in %s, binding to 127.0.0.1, and lets anyone sign in',
    async (file) => {
      const text = readFileSync(join(import.meta.dirname, '..', '..', '..', file), 'utf8')
      const command = /```sh\n(docker run -p 127\.0\.0\.1:[^`]*?HB_DEV_LOGIN=1[^`]*?)```/.exec(text)?.[1]
      expect(command).toBeDefined()
      const variables = Object.fromEntries(
        [...command!.matchAll(/-e (HB_[A-Z_]+)=(\S+)/g)].map((match) => [match[1]!, match[2]!]),
      )
      expect(variables).toEqual({ HB_PUBLIC_URL: 'http://localhost:8080', HB_DEV_LOGIN: '1' })
      expect(loadConfig(variables)).toMatchObject({ _tag: 'Ok', value: { identity: { devLogin: true } } })
      server = await startTestServer({ ...variables, HB_ALLOWED_DOMAINS: '' })
      expect((await server.signIn('ana@any.example')).me.member.role).toBe('admin')
    },
  )

  it('makes the first member an administrator, since nobody else could be', async () => {
    server = await startTestServer()
    expect((await server.signIn('first@example.com')).me.member.role).toBe('admin')
    expect((await server.signIn('second@example.com')).me.member.role).toBe('member')
  })

  it('wears the organization theme when one is set', async () => {
    server = await startTestServer()
    expect(String((await server.request('GET', '/auth/dev')).raw.body)).not.toContain('/theme.css')
    await server.close()
    server = await startTestServer({ HB_THEME_DIR: mkdtempSync(join(tmpdir(), 'hb-theme-')) })
    const page = String((await server.request('GET', '/auth/dev')).raw.body)
    expect(page).toContain(
      '<link rel="stylesheet" href="/dev-login.css">\n<link rel="stylesheet" href="/theme.css">',
    )
  })

  it('is served only when enabled, and refuses a form without an email', async () => {
    server = await startTestServer()
    const form = await server.request('GET', '/auth/dev?state="><script>')
    expect(form.status).toBe(200)
    expect(String(form.raw.body)).not.toContain('"><script>')
    const state = new URL((await server.request('GET', '/auth/login')).headers.location!).searchParams.get(
      'state',
    )!
    const submitted = await server.request('POST', '/auth/dev', { form: { state, email: '', name: 'x' } })
    expect(refusalOf(await server.request('GET', submitted.headers.location!))).toMatch(/not filled in/)
    expect((await server.request('GET', '/auth/unknown')).status).toBe(404)
  })

  it('does not exist when the server uses a real provider', async () => {
    await withIssuer(makeFakeIssuer())
    expect((await server.request('GET', '/auth/dev')).status).toBe(404)
    expect((await server.request('POST', '/auth/dev', { form: {} })).status).toBe(404)
  })

  it('limits sign-in attempts per address', async () => {
    server = await startTestServer()
    for (let attempt = 0; attempt < 300; attempt++) await server.request('GET', '/auth/login')
    expect((await server.request('GET', '/auth/login')).status).toBe(429)
  })
})

describe('sign-in helpers', () => {
  it.each([
    ['/#/c/1', '/#/c/1'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/\t/evil.example', '/'],
    ['/\n/evil.example', '/'],
    ['/ok\r\nset-cookie: x', '/'],
    ['/a\\b', '/'],
    ['https://evil.example', '/'],
    [
      '/oauth/authorize?client_id=https%3A%2F%2Fclaude.ai%2Fx&state=a%20b',
      '/oauth/authorize?client_id=https%3A%2F%2Fclaude.ai%2Fx&state=a%20b',
    ],
    [undefined, '/'],
  ])('keeps return path %s inside the site as %s', (input, expected) => {
    expect(localPath(input)).toBe(expected)
  })

  it.each([
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537 Edg/130', 'Edge on Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1', 'Safari on iOS'],
    ['Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537', 'Chrome on Android'],
    ['curl/8', 'Browser'],
  ])('names the device for %s', (userAgent, name) => {
    expect(describeBrowser(userAgent)).toBe(name)
  })
})
