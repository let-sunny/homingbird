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
})
