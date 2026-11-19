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

describe('refresh tokens and revocation', () => {
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
})
