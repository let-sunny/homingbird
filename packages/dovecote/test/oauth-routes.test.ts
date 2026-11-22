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

afterEach(() => server?.close())

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

describe('the token endpoint', () => {
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
