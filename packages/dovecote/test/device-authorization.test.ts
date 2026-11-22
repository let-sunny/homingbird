import { createHash } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIMITS } from '../src/http/rate-limiter.ts'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
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

const deactivateAna = () =>
  T.runPromise(run(sql`UPDATE members SET status = 'deactivated' WHERE id = ${ana.me.member.id}`), server.env)

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

describe('device authorization', () => {
  const start = (scope = 'notes') =>
    server.request('POST', '/oauth/device_authorization', { form: { client_name: 'Terminal', scope } })
  const poll = (deviceCode: string) => token({ grant_type: DEVICE_GRANT, device_code: deviceCode })

  it('issues nothing for a request a person approved before they were deactivated', async () => {
    const started = (await start()).json
    await ana.api('POST', `/device/${started.user_code}`, { approve: true, name: 'My laptop' })
    await deactivateAna()
    expect((await poll(started.device_code)).json.error).toBe('invalid_grant')
  })

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
    })
    await ana.api('POST', `/device/${started.user_code}`, { approve: true, name: 'My laptop' })
    const tokens = (await poll(started.device_code)).json
    expect(tokens.access_token).toMatch(/^hba_/)
    expect(tokens.refresh_token).toBeUndefined()
    expect(tokens.scope).toBe('notes')
    expect((await poll(started.device_code)).json.error).toBe('invalid_grant')
    expect((await ana.api('POST', `/device/${started.user_code}`, { approve: true })).status).toBe(404)
  })

  it('issues an agent credential and nothing else, whatever scope the device asks for', async () => {
    const asked = (await start('notes approve')).json
    expect((await ana.api('GET', `/device/${asked.user_code}`)).json).not.toHaveProperty('wantsApproval')
    await ana.api('POST', `/device/${asked.user_code}`, { approve: true, allowApproval: true })
    const tokens = (await poll(asked.device_code)).json
    expect(tokens.access_token).toMatch(/^hba_/)
    expect(tokens.scope).toBe('notes')
    expect(Object.keys(tokens).sort()).toEqual(['access_token', 'expires_in', 'scope', 'token_type'])
  })

  it('tells clients nothing about an approve button', async () => {
    expect((await server.request('GET', '/api/v1/info')).json).not.toHaveProperty('approveButton')
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

  it('lets a whole office behind one address start agent sign-ins, up to a ceiling that says when to retry', async () => {
    for (let attempt = 0; attempt < LIMITS.deviceStart.max; attempt++)
      expect((await start()).status).toBe(200)
    await server.clock.advance(600_000)
    const refused = await start()
    expect(refused.status).toBe(429)
    expect(refused.headers['retry-after']).toBe('3000')
    expect(refused.json).toEqual({
      error: 'slow_down',
      error_description: 'Too many requests from this network. Try again in 50 min.',
    })
    await server.clock.advance(3_000_000)
    expect((await start()).status).toBe(200)
  })

  it('limits how many agent sign-ins one person decides in an hour, whatever address they use', async () => {
    for (let attempt = 0; attempt < LIMITS.deviceApproval.max; attempt++) {
      const started = (await start()).json
      expect((await ana.api('POST', `/device/${started.user_code}`, { approve: false })).status).toBe(200)
    }
    const started = (await start()).json
    expect((await ana.api('POST', `/device/${started.user_code}`, { approve: true })).status).toBe(429)
    const ben = await server.signIn('ben@example.com', 'Ben')
    expect((await ben.api('POST', `/device/${started.user_code}`, { approve: true })).status).toBe(200)
  })
})
