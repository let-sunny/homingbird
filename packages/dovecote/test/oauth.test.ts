import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, startTestServer } from './harness.ts'

const REDIRECT = 'https://client.example/callback'
const VERIFIER = 'v'.repeat(64)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

let server: TestServer
let ana: Session

beforeEach(async () => {
  server = await startTestServer({ HB_OAUTH_REDIRECT_HOSTS: 'client.example' })
  ana = await server.signIn('ana@example.com', 'Ana')
})

afterEach(() => server.close())

const register = async (body: unknown = { client_name: 'Connector', redirect_uris: [REDIRECT] }) =>
  server.request('POST', '/oauth/register', { body })

const authorizePath = (clientId: string, overrides: Record<string, string> = {}) =>
  `/oauth/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'xyz',
    ...overrides,
  })}`

const authorize = (clientId: string, overrides: Record<string, string> = {}) =>
  server.request('GET', authorizePath(clientId, overrides), { cookie: ana.cookie })

const consentIdOf = (response: { headers: Readonly<Record<string, string>> }) =>
  response.headers.location!.split('/#/consent/')[1]!

const token = (form: Record<string, string>) => server.request('POST', '/oauth/token', { form })

const codeFor = async (clientId: string) => {
  const consentId = consentIdOf(await authorize(clientId))
  const decided = await ana.api('POST', `/consent/${consentId}`, { approve: true, name: 'My connector' })
  return new URL(decided.json.redirectTo).searchParams.get('code')!
}

const exchange = (clientId: string, code: string, overrides: Record<string, string> = {}) =>
  token({
    grant_type: 'authorization_code',
    code,
    code_verifier: VERIFIER,
    client_id: clientId,
    redirect_uri: REDIRECT,
    ...overrides,
  })

describe('discovery', () => {
  it('describes the authorization server and the protected resource', async () => {
    const metadata = (await server.request('GET', '/.well-known/oauth-authorization-server')).json
    expect(metadata).toMatchObject({
      issuer: 'http://localhost:8080',
      token_endpoint: 'http://localhost:8080/oauth/token',
      registration_endpoint: 'http://localhost:8080/oauth/register',
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token', DEVICE_GRANT],
    })
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])
      expect((await server.request('GET', path)).json).toMatchObject({
        resource: 'http://localhost:8080/mcp',
        authorization_servers: ['http://localhost:8080'],
      })
  })

  it('answers preflight requests and lets other origins read OAuth and agent endpoints', async () => {
    const preflight = await server.request('OPTIONS', '/oauth/token')
    expect(preflight.status).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('*')
    expect(
      (await server.request('GET', '/.well-known/oauth-authorization-server')).headers[
        'access-control-allow-origin'
      ],
    ).toBe('*')
    expect(
      (await server.request('GET', '/api/v1/info')).headers['access-control-allow-origin'],
    ).toBeUndefined()
  })

  it('challenges an unauthenticated MCP call with the resource metadata location', async () => {
    const refused = await server.request('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' } })
    expect(refused.status).toBe(401)
    expect(refused.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="http://localhost:8080/.well-known/oauth-protected-resource"',
    )
    expect((await server.request('POST', '/mcp', { cookie: ana.cookie, body: {} })).status).toBe(401)
  })
})

describe('dynamic client registration', () => {
  it('registers a public client', async () => {
    const registered = await register()
    expect(registered.status).toBe(201)
    expect(registered.json).toMatchObject({
      client_name: 'Connector',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
    })
    expect(registered.json.client_id).toMatch(/^client_/)
  })

  it.each([
    [{ client_name: 'x', redirect_uris: [] }],
    [{ client_name: 'x' }],
    [{ client_name: 'x', redirect_uris: ['http://attacker.example/cb'] }],
    [{ client_name: 'x', redirect_uris: ['javascript:alert(1)'] }],
    [{ client_name: 'x', redirect_uris: ['https://client.example/cb#fragment'] }],
    [
      {
        client_name: 'x',
        redirect_uris: Array.from({ length: 11 }, (_, i) => `https://client.example/${i}`),
      },
    ],
    ['not an object'],
  ])('refuses %j', async (body) => {
    expect((await register(body)).status).toBe(400)
  })

  it('refuses a body that is not JSON', async () => {
    const refused = await server.request('POST', '/oauth/register', { form: { client_name: 'x' } })
    expect(refused.status).toBe(400)
  })
})

describe('authorization code with PKCE', () => {
  it('issues an agent credential with a refresh token after the person consents', async () => {
    const { client_id: clientId } = (await register()).json
    const started = await authorize(clientId)
    expect(started.status).toBe(302)
    const consentId = consentIdOf(started)
    expect((await ana.api('GET', `/consent/${consentId}`)).json).toMatchObject({
      client: 'Connector',
      redirectHost: 'client.example',
    })
    const decided = (await ana.api('POST', `/consent/${consentId}`, { approve: true, name: 'My connector' }))
      .json
    const redirect = new URL(decided.redirectTo)
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT)
    expect(redirect.searchParams.get('state')).toBe('xyz')
    expect(redirect.searchParams.get('iss')).toBe('http://localhost:8080')

    const tokens = (await exchange(clientId, redirect.searchParams.get('code')!)).json
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'notes' })
    expect(tokens.access_token).toMatch(/^hba_/)
    expect(tokens.refresh_token).toMatch(/^hbr_/)
    const me = (await server.request('GET', '/api/v1/me', { token: tokens.access_token })).json
    expect(me.credential).toMatchObject({ kind: 'agent', name: 'My connector' })
  })

  it('redirects with access_denied when the person refuses, and the request cannot be reused', async () => {
    const { client_id: clientId } = (await register()).json
    const consentId = consentIdOf(await authorize(clientId))
    const denied = (await ana.api('POST', `/consent/${consentId}`, { approve: false })).json
    expect(new URL(denied.redirectTo).searchParams.get('error')).toBe('access_denied')
    expect((await ana.api('POST', `/consent/${consentId}`, { approve: true })).status).toBe(404)
    expect((await ana.api('GET', `/consent/${consentId}`)).status).toBe(404)
  })

  it.each([
    [{ client_id: 'client_unknown' }],
    [{ redirect_uri: 'https://client.example/other' }],
    [{ response_type: 'token' }],
    [{ code_challenge_method: 'plain' }],
    [{ code_challenge: 'short' }],
  ])('refuses to start with %j, without redirecting anywhere', async (overrides) => {
    const { client_id: clientId } = (await register()).json
    const refused = await authorize(clientId, overrides)
    expect(refused.status).toBe(400)
    expect(refused.headers.location).toBeUndefined()
  })

  it('uses a code once, and only with the right verifier, client and redirect', async () => {
    const { client_id: clientId } = (await register()).json
    for (const wrong of [
      { code_verifier: 'w'.repeat(64) },
      { client_id: 'client_other' },
      { redirect_uri: 'https://client.example/x' },
    ]) {
      const refused = await exchange(clientId, await codeFor(clientId), wrong)
      expect([wrong, refused.status, refused.json.error]).toEqual([wrong, 400, 'invalid_grant'])
    }
    const code = await codeFor(clientId)
    expect((await exchange(clientId, code)).status).toBe(200)
    expect((await exchange(clientId, code)).json.error).toBe('invalid_grant')
    expect((await exchange(clientId, 'made-up')).json.error).toBe('invalid_grant')
  })

  it('lets a consent request expire', async () => {
    const { client_id: clientId } = (await register()).json
    const consentId = consentIdOf(await authorize(clientId))
    await server.clock.advance(10 * 60_000)
    expect((await ana.api('POST', `/consent/${consentId}`, { approve: true })).status).toBe(404)
  })

  it('rotates refresh tokens, expires access tokens after an hour, and refuses a stale refresh token', async () => {
    const { client_id: clientId } = (await register()).json
    const first = (await exchange(clientId, await codeFor(clientId))).json
    await server.clock.advance(60 * 60_000)
    expect((await server.request('GET', '/api/v1/me', { token: first.access_token })).status).toBe(401)
    const second = (await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token })).json
    expect(second.access_token).not.toBe(first.access_token)
    expect((await server.request('GET', '/api/v1/me', { token: second.access_token })).status).toBe(200)
    expect(
      (await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token })).json.error,
    ).toBe('invalid_grant')
    expect((await token({ grant_type: 'refresh_token', refresh_token: second.refresh_token })).status).toBe(
      200,
    )
  })

  it('revokes by access or refresh token', async () => {
    const { client_id: clientId } = (await register()).json
    const tokens = (await exchange(clientId, await codeFor(clientId))).json
    expect(
      (await server.request('POST', '/oauth/revoke', { form: { token: tokens.refresh_token } })).status,
    ).toBe(200)
    expect((await server.request('GET', '/api/v1/me', { token: tokens.access_token })).status).toBe(401)
    expect(
      (await token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).json.error,
    ).toBe('invalid_grant')
    expect((await server.request('POST', '/oauth/revoke', { form: {} })).status).toBe(200)
  })

  it('accepts token requests as JSON as well as form fields', async () => {
    const asJson = await server.request('POST', '/oauth/token', {
      body: { grant_type: 'password', scope: 7 },
    })
    expect(asJson.json.error).toBe('unsupported_grant_type')
    const notAnObject = await server.request('POST', '/oauth/token', { body: 'text' })
    expect(notAnObject.json.error).toBe('unsupported_grant_type')
    const empty = await server.request('POST', '/oauth/token', {
      headers: { 'content-type': 'application/json' },
    })
    expect(empty.json.error).toBe('unsupported_grant_type')
  })

  it('refuses an unknown grant type and an unknown path', async () => {
    expect((await token({ grant_type: 'password' })).json.error).toBe('unsupported_grant_type')
    expect((await server.request('GET', '/oauth/nothing')).status).toBe(404)
  })
})

describe('device authorization', () => {
  const start = (scope = 'notes') =>
    server.request('POST', '/oauth/device_authorization', { form: { client_name: 'Terminal', scope } })
  const poll = (deviceCode: string) => token({ grant_type: DEVICE_GRANT, device_code: deviceCode })

  it('hands out a code to type in, and waits until the person decides', async () => {
    const started = (await start()).json
    expect(started.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
    expect(started).toMatchObject({
      verification_uri: 'http://localhost:8080/#/device',
      verification_uri_complete: `http://localhost:8080/#/device/${started.user_code}`,
      expires_in: 600,
      interval: 5,
    })
    expect((await poll(started.device_code)).json.error).toBe('authorization_pending')
    const typed = started.user_code.toLowerCase().replace('-', ' ')
    expect((await ana.api('GET', `/device/${encodeURIComponent(typed)}`)).json).toMatchObject({
      client: 'Terminal',
      wantsApproval: false,
    })
    await ana.api('POST', `/device/${started.user_code}`, { approve: true, name: 'My laptop' })
    const tokens = (await poll(started.device_code)).json
    expect(tokens.access_token).toMatch(/^hba_/)
    expect(tokens.refresh_token).toBeUndefined()
    expect(tokens.approval_token).toBeUndefined()
    expect((await poll(started.device_code)).json.error).toBe('invalid_grant')
    expect((await ana.api('POST', `/device/${started.user_code}`, { approve: true })).status).toBe(404)
  })

  it('issues the approval credential only when it was asked for and the person granted it', async () => {
    const granted = (await start('notes approve')).json
    expect((await ana.api('GET', `/device/${granted.user_code}`)).json.wantsApproval).toBe(true)
    await ana.api('POST', `/device/${granted.user_code}`, { approve: true, allowApproval: true })
    const withButton = (await poll(granted.device_code)).json
    expect(withButton.approval_token).toMatch(/^hbh_/)
    expect(withButton.scope).toBe('notes approve')

    const declined = (await start('notes approve')).json
    await ana.api('POST', `/device/${declined.user_code}`, { approve: true })
    expect((await poll(declined.device_code)).json.approval_token).toBeUndefined()

    const notAsked = (await start('notes')).json
    await ana.api('POST', `/device/${notAsked.user_code}`, { approve: true, allowApproval: true })
    const plain = (await poll(notAsked.device_code)).json
    expect(plain.approval_token).toBeUndefined()
    expect(plain.scope).toBe('notes')
  })

  it('reports denial and expiry', async () => {
    const denied = (await start()).json
    await ana.api('POST', `/device/${denied.user_code}`, { approve: false })
    expect((await poll(denied.device_code)).json.error).toBe('access_denied')

    const expired = (await start()).json
    await server.clock.advance(600_000)
    expect((await poll(expired.device_code)).json.error).toBe('expired_token')
    expect((await ana.api('GET', `/device/${expired.user_code}`)).status).toBe(404)
    expect((await poll('unknown-code')).json.error).toBe('expired_token')
  })

  it('limits how fast one address can start device flows', async () => {
    for (let attempt = 0; attempt < 30; attempt++) expect((await start()).status).toBe(200)
    expect((await start()).status).toBe(429)
    await server.clock.advance(3_600_000)
    expect((await start()).status).toBe(200)
  })
})
