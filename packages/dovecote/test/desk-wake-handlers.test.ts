import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import {
  ROUTINE_URL,
  WAKE_TOKEN,
  agentCredentialOf,
  fakeService,
  routineSetup,
  startCloudDeskServer,
} from './cloud-desk-support.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  connectAgent,
  everyStoredValue,
  startTestServer,
  storedRows,
} from './harness.ts'

let server: TestServer
let ana: Session
let agent: Agent
let credentialId: string
const service = fakeService()

beforeEach(async () => {
  service.calls.length = 0
  server = await startCloudDeskServer(service)
  ana = await server.signIn('ana@example.com', 'Ana')
  agent = await connectAgent(server, ana, { name: 'Cloud desk' })
  credentialId = await agentCredentialOf(ana)
})

afterEach(() => server?.close())

const audited = async () =>
  (await storedRows(server, 'audit_events'))
    .filter((row) => String(row.event).startsWith('desk_wake.'))
    .map((row) => [row.event, row.target_id, JSON.parse(String(row.detail))])

describe('a person’s cloud desk wake', () => {
  it('is set up by its person and read back with the host and header names only', async () => {
    expect((await ana.api('GET', '/me/desk-wake')).json).toEqual({ wake: null })
    const saved = await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    expect(saved.status).toBe(200)
    const read = await ana.api('GET', '/me/desk-wake')
    expect(read.json.wake).toEqual({
      host: 'api.anthropic.com',
      headerNames: ['Authorization', 'anthropic-version'],
      credentialId,
      enabled: true,
      lastWakeAt: null,
      lastStatus: 'never',
      failures: 0,
      stoppedBecause: null,
      createdAt: server.clock.now(),
      updatedAt: server.clock.now(),
    })
    expect(saved.json).toEqual(read.json.wake)
    const text = JSON.stringify(read.json)
    expect(text).not.toContain(WAKE_TOKEN)
    expect(text).not.toContain('trig_01ABCDEF')
  })

  it('keeps the address and token sealed, never in the clear', async () => {
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    const stored = await everyStoredValue(server)
    expect(stored).not.toContain(WAKE_TOKEN)
    expect(stored).not.toContain('trig_01ABCDEF')
    expect(String((await storedRows(server, 'desk_wakes'))[0]!.sealed)).toMatch(/^v1\./)
  })

  it('replaces the whole setup each time, keeping when it was first made', async () => {
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    const created = server.clock.now()
    await server.clock.advance(60_000)
    const replaced = await ana.api(
      'PUT',
      '/me/desk-wake',
      routineSetup(credentialId, { headers: [{ name: 'X-Api-Key', value: 'other' }], enabled: false }),
    )
    expect(replaced.json).toMatchObject({ headerNames: ['X-Api-Key'], enabled: false, createdAt: created })
    expect(replaced.json.updatedAt).toBe(created + 60_000)
    expect(await storedRows(server, 'desk_wakes')).toHaveLength(1)
  })

  it('refuses an address on another host, a reserved header, or a credential that is not the person’s agent', async () => {
    const ben = await server.signIn('ben@example.com', 'Ben')
    await connectAgent(server, ben, { name: 'Ben desk' })
    const refusals = [
      routineSetup(credentialId, { url: 'https://evil.example/fire' }),
      routineSetup(credentialId, { headers: [{ name: 'Cookie', value: 'a=b' }] }),
      routineSetup(ana.me.credential.id),
      routineSetup(await agentCredentialOf(ben)),
    ]
    for (const body of refusals) expect((await ana.api('PUT', '/me/desk-wake', body)).status).toBe(400)
    expect(await storedRows(server, 'desk_wakes')).toEqual([])
  })

  it('refuses a revoked agent credential', async () => {
    await ana.api('DELETE', `/credentials/${credentialId}`)
    expect((await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))).status).toBe(400)
  })

  it('is removed for good, and says so when there is none', async () => {
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    expect((await ana.api('DELETE', '/me/desk-wake')).status).toBe(200)
    expect(await storedRows(server, 'desk_wakes')).toEqual([])
    expect((await ana.api('DELETE', '/me/desk-wake')).status).toBe(404)
  })

  it('is audited when set up and removed, with its host only', async () => {
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    await ana.api('DELETE', '/me/desk-wake')
    expect(await audited()).toEqual([
      ['desk_wake.registered', ana.me.member.id, { host: 'api.anthropic.com' }],
      ['desk_wake.removed', ana.me.member.id, { host: 'api.anthropic.com' }],
    ])
    expect(JSON.stringify(await storedRows(server, 'audit_events'))).not.toContain(WAKE_TOKEN)
  })

  it('is deleted, audited, when an administrator deactivates its person', async () => {
    const ben = await server.signIn('ben@example.com', 'Ben')
    await connectAgent(server, ben, { name: 'Ben desk' })
    await ben.api('PUT', '/me/desk-wake', routineSetup(await agentCredentialOf(ben)))
    const deactivated = await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, {
      status: 'deactivated',
    })
    expect(deactivated.status).toBe(200)
    expect(await storedRows(server, 'desk_wakes')).toEqual([])
    expect((await audited()).at(-1)).toEqual([
      'desk_wake.removed',
      ben.me.member.id,
      { host: 'api.anthropic.com', because: 'deactivated' },
    ])
  })

  it('refuses every agent credential, its own bound one included', async () => {
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    for (const [method, path, body] of [
      ['GET', '/me/desk-wake', undefined],
      ['PUT', '/me/desk-wake', routineSetup(credentialId, { url: 'https://api.anthropic.com/other' })],
      ['DELETE', '/me/desk-wake', undefined],
      ['POST', '/me/desk-wake/test', {}],
    ] as const)
      expect([method, path, (await agent.api(method, path, body)).status]).toEqual([method, path, 403])
    expect(service.wakes()).toEqual([])
    expect((await storedRows(server, 'desk_wakes'))[0]).toMatchObject({ host: 'api.anthropic.com' })
  })

  it('tests a wake on request, reporting the service’s status without keeping anything', async () => {
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    const before = await storedRows(server, 'desk_wakes')
    service.answers.push(401)
    expect((await ana.api('POST', '/me/desk-wake/test', {})).json).toEqual({
      status: 401,
      outcome: 'refused',
    })
    expect((await ana.api('POST', '/me/desk-wake/test', {})).json).toEqual({ status: 200, outcome: 'sent' })
    expect(service.wakes().map((call) => call.url)).toEqual([ROUTINE_URL, ROUTINE_URL])
    expect(await storedRows(server, 'desk_wakes')).toEqual(before)
    expect(server.logged.filter((line) => line.includes('desk_wake.fired'))).toHaveLength(2)
    expect(server.logged.join('\n')).not.toContain(WAKE_TOKEN)
  })

  it('allows five test wakes an hour', async () => {
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    for (let tried = 0; tried < 5; tried++)
      expect((await ana.api('POST', '/me/desk-wake/test', {})).status).toBe(200)
    expect((await ana.api('POST', '/me/desk-wake/test', {})).status).toBe(429)
    await server.clock.advance(60 * 60_000)
    expect((await ana.api('POST', '/me/desk-wake/test', {})).status).toBe(200)
  })

  it('counts test wakes per person, whichever browser they come from', async () => {
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    const again = await server.signIn('ana@example.com', 'Ana')
    for (let tried = 0; tried < 5; tried++)
      expect((await (tried % 2 === 0 ? ana : again).api('POST', '/me/desk-wake/test', {})).status).toBe(200)
    expect((await again.api('POST', '/me/desk-wake/test', {})).status).toBe(429)
  })

  it('cannot test a wake that is not set up', async () => {
    expect((await ana.api('POST', '/me/desk-wake/test', {})).status).toBe(404)
  })
})

describe('the cloud desk feature', () => {
  it('is offered only with a key to seal wakes, and never shows the key', async () => {
    const info = (await server.request('GET', '/api/v1/info')).json
    expect(info.features.cloudDesk).toBe(true)
    const unkeyed = await startTestServer({ HB_FEATURES: 'cloudDesk=on' })
    expect((await unkeyed.request('GET', '/api/v1/info')).json.features.cloudDesk).toBe(false)
    const person = await unkeyed.signIn('ana@example.com', 'Ana')
    expect((await person.api('GET', '/me/desk-wake')).status).toBe(404)
    await unkeyed.close()
    expect(JSON.stringify(info)).not.toContain(Buffer.alloc(32, 7).toString('base64'))
  })

  it('lets its person remove a saved wake while the feature is off', async () => {
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    const settings = (await ana.api('GET', '/admin/settings')).json
    await ana.api('PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, cloudDesk: false },
    })
    expect((await ana.api('GET', '/me/desk-wake')).status).toBe(404)
    expect((await ana.api('DELETE', '/me/desk-wake')).status).toBe(200)
    expect(await storedRows(server, 'desk_wakes')).toEqual([])
  })

  it('lets its person remove a saved wake on a server that lost its key', async () => {
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    const unkeyed = server.requestWithSettings({ HB_SECRETS_KEY: '' })
    expect((await unkeyed('GET', '/api/v1/me/desk-wake', { cookie: ana.cookie })).status).toBe(404)
    expect((await unkeyed('DELETE', '/api/v1/me/desk-wake', { cookie: ana.cookie })).status).toBe(200)
    expect(await storedRows(server, 'desk_wakes')).toEqual([])
  })

  it('serves the bound credential as a desk on /mcp, and no other', async () => {
    const other = await connectAgent(server, ana, { name: 'Laptop' })
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    const instructions = async (token: string) =>
      (
        await server.request('POST', '/mcp', {
          token,
          body: {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 't', version: '1' },
            },
          },
        })
      ).json.result.instructions as string
    expect(await instructions(agent.token)).toMatch(/This is your human’s Homingbird desk session/)
    expect(await instructions(other.token)).not.toMatch(/This is your human’s Homingbird desk session/)
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId, { enabled: false }))
    expect(await instructions(agent.token)).not.toMatch(/This is your human’s Homingbird desk session/)
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    await T.runPromise(run(sql`UPDATE desk_wakes SET stopped_because = 'failures'`), server.env)
    expect(await instructions(agent.token)).not.toMatch(/This is your human’s Homingbird desk session/)
  })
})
