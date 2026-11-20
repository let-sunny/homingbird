import { createECDH } from 'node:crypto'
import { Task as T, type TestClock } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run as run_ } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import {
  type FakeService,
  ROUTINE_URL,
  WAKE_TOKEN,
  agentCredentialOf,
  fakeService,
  routineSetup,
  startCloudDeskServer,
} from './cloud-desk-support.ts'
import { castOf, openedRoom } from './debate-support.ts'
import { type Agent, type Session, type TestServer, asShown, connectAgent, storedRows } from './harness.ts'

const MINUTE = 60_000
const PUSH_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/ana'

let server: TestServer
let service: FakeService
let ana: Session
let ben: Session
let agent: Agent
let credentialId: string
let started: boolean

const start = async (overrides: Readonly<Record<string, string>> = {}) => {
  service = fakeService()
  server = await startCloudDeskServer(service, overrides)
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  agent = await connectAgent(server, ana, { name: 'Cloud desk' })
  credentialId = await agentCredentialOf(ana)
  await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
}

/**
 * The pass runs where the background loop would, every 15 seconds, but the test runs each one to its
 * end, so a database whose driver does real I/O is read only once it is done. Desks that keep awake
 * send their heartbeat after each step.
 */
const run = async () => {
  started = true
  await server.wakePass()
}

const wait = async (ms: number, stride = 15_000) => {
  const clock = server.env.clock as TestClock
  for (let passed = 0; passed < ms; passed += stride) {
    await clock.advance(Math.min(stride, ms - passed))
    for (const heartbeat of [...server.desks]) await heartbeat()
    if (started) await server.wakePass()
  }
}

const noteToAna = async (body = 'Can you check the invoice?') => {
  const draft = (await ben.api('POST', '/drafts', { to: [ana.me.member.id], body })).json
  return (await ben.api('POST', `/drafts/${draft.id}/send`, await asShown(ben, draft.id))).json
}

const wake = async () => (await ana.api('GET', '/me/desk-wake')).json.wake

const fired = () =>
  server.logged
    .filter((line) => line.includes('"desk_wake.fired"'))
    .map((line) => JSON.parse(line).attributes)

const audited = async () =>
  (await storedRows(server, 'audit_events'))
    .filter((row) => row.event === 'desk_wake.stopped')
    .map((row) => JSON.parse(String(row.detail)))

const subscribeAna = async () => {
  const keys = createECDH('prime256v1')
  keys.generateKeys()
  await ana.api('POST', '/push/subscriptions', {
    endpoint: PUSH_ENDPOINT,
    keys: {
      p256dh: keys.getPublicKey('base64url'),
      auth: Buffer.from('0123456789abcdef').toString('base64url'),
    },
  })
}

const pushes = () => service.calls.filter((call) => call.url === PUSH_ENDPOINT)

beforeEach(() => {
  started = false
})

afterEach(async () => {
  await server.close()
})

describe('waking a cloud desk', () => {
  beforeEach(() => start())

  it('wakes once for a burst of notes, after gathering them for 30 seconds', async () => {
    await run()
    await noteToAna('First')
    await wait(10_000)
    await noteToAna('Second')
    await wait(10_000)
    expect(service.wakes()).toEqual([])
    await wait(20_000)
    expect(service.wakes()).toHaveLength(1)
    const [{ url, init }] = service.wakes() as [{ url: string; init: RequestInit }]
    expect(url).toBe(ROUTINE_URL)
    expect(init.redirect).toBe('manual')
    expect(JSON.parse(String(init.body))).toEqual({
      text: 'Homingbird: work is waiting at http://localhost:8080.',
    })
    expect(JSON.stringify(init.body)).not.toMatch(/First|Second|Ben/)
    await noteToAna('Third')
    await wait(4 * MINUTE)
    expect(service.wakes()).toHaveLength(1)
    expect(await wake()).toMatchObject({ lastStatus: 'sent', failures: 0 })
  })

  it('logs each wake with the host and outcome, never the token or the address', async () => {
    await run()
    await noteToAna()
    await wait(45_000)
    expect(fired()).toEqual([
      {
        memberId: ana.me.member.id,
        host: 'api.anthropic.com',
        status: 200,
        timedOut: false,
        outcome: 'sent',
        reason: 'work',
      },
    ])
    expect(server.logged.join('\n')).not.toContain(WAKE_TOKEN)
    expect(server.logged.join('\n')).not.toContain('trig_01ABCDEF')
  })

  it('marks the wake answered once the woken desk uses its credential, and wakes again five minutes on', async () => {
    await run()
    await noteToAna('First')
    await wait(45_000)
    expect(service.wakes()).toHaveLength(1)
    const inbox = (await agent.api('GET', '/inbox?fresh=1')).json.items
    for (const item of inbox) await agent.api('POST', `/notes/${item.note.id}/pickup`)
    await wait(15_000)
    expect(await wake()).toMatchObject({ lastStatus: 'online', failures: 0 })
    await noteToAna('Second')
    await wait(2 * MINUTE)
    expect(service.wakes()).toHaveLength(1)
    await wait(3 * MINUTE)
    expect(service.wakes()).toHaveLength(2)
  })

  it('does not wake for work the desk already took', async () => {
    await run()
    const note = await noteToAna()
    await agent.api('POST', `/notes/${note.id}/pickup`)
    await wait(3 * MINUTE)
    expect(service.wakes()).toEqual([])
  })

  it('never wakes while an agent of the person holds an event stream', async () => {
    const stream = new AbortController()
    server.env.hub.subscribe(ana.me.member.id as never, 'agent', stream.signal)
    await run()
    await noteToAna()
    await wait(3 * MINUTE)
    expect(service.wakes()).toEqual([])
    stream.abort()
  })

  it('waits until the bound credential has been silent for two minutes', async () => {
    await run()
    await noteToAna()
    await agent.api('GET', '/me')
    await wait(MINUTE)
    expect(service.wakes()).toEqual([])
    await wait(75_000)
    expect(service.wakes()).toHaveLength(1)
  })

  it('wakes, after a restart, for work that arrived while it was down', async () => {
    await noteToAna()
    await run()
    await wait(15_000)
    expect(service.wakes()).toEqual([])
    await wait(30_000)
    expect(service.wakes()).toHaveLength(1)
  })

  it('wakes nothing that is paused, and nothing while the feature is off', async () => {
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId, { enabled: false }))
    await run()
    await noteToAna()
    await wait(MINUTE)
    expect(service.wakes()).toEqual([])
    await ana.api('PUT', '/me/desk-wake', routineSetup(credentialId))
    const settings = (await ana.api('GET', '/admin/settings')).json
    await ana.api('PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, cloudDesk: false },
    })
    await noteToAna()
    await wait(MINUTE)
    expect(service.wakes()).toEqual([])
    await ana.api('PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, cloudDesk: true },
    })
    await wait(MINUTE)
    expect(service.wakes()).toHaveLength(1)
  })
})

describe('a wake that fails', () => {
  beforeEach(() => start())

  it('stops at once when the service refuses it, audited and told to the person', async () => {
    await subscribeAna()
    service.answers.push(401)
    await run()
    await noteToAna()
    await wait(45_000)
    expect(await wake()).toMatchObject({ lastStatus: 'refused', stoppedBecause: 'refused' })
    expect(await audited()).toEqual([{ host: 'api.anthropic.com', because: 'refused' }])
    expect(pushes()).toHaveLength(1)
    await noteToAna()
    await wait(10 * MINUTE)
    expect(service.wakes()).toHaveLength(1)
  })

  it('backs off 5, 15 and 60 minutes after server errors, and stops after five in a row', async () => {
    await subscribeAna()
    service.answers.push(500, 503, 502, 500, 500)
    await run()
    await noteToAna()
    await wait(45_000)
    expect(service.wakes()).toHaveLength(1)
    await wait(4 * MINUTE)
    expect(service.wakes()).toHaveLength(1)
    await wait(MINUTE)
    expect(service.wakes()).toHaveLength(2)
    await wait(15 * MINUTE, MINUTE)
    expect(service.wakes()).toHaveLength(3)
    expect(await wake()).toMatchObject({ lastStatus: 'unreachable', failures: 3, stoppedBecause: null })
    await wait(60 * MINUTE, MINUTE)
    await wait(60 * MINUTE, MINUTE)
    expect(service.wakes()).toHaveLength(5)
    expect(await wake()).toMatchObject({ failures: 5, stoppedBecause: 'failures' })
    expect(await audited()).toEqual([{ host: 'api.anthropic.com', because: 'failures' }])
    expect(pushes()).toHaveLength(1)
    await wait(60 * MINUTE, MINUTE)
    expect(service.wakes()).toHaveLength(5)
  })

  it('waits as long as Retry-After asks', async () => {
    service.answers.push({ status: 429, retryAfter: '600' })
    await run()
    await noteToAna()
    await wait(45_000)
    expect(await wake()).toMatchObject({ lastStatus: 'rate_limited', failures: 1 })
    await wait(9 * MINUTE)
    expect(service.wakes()).toHaveLength(1)
    await wait(MINUTE)
    expect(service.wakes()).toHaveLength(2)
    expect(await wake()).toMatchObject({ lastStatus: 'sent', failures: 1 })
  })

  it('counts a desk that never came online within ten minutes, and wakes again', async () => {
    await run()
    await noteToAna()
    await wait(45_000)
    expect(service.wakes()).toHaveLength(1)
    await wait(10 * MINUTE)
    expect(await wake()).toMatchObject({ lastStatus: 'not_online', failures: 1 })
    expect(server.logged.some((line) => line.includes('"desk_wake.unanswered"'))).toBe(true)
    await wait(5 * MINUTE)
    expect(service.wakes()).toHaveLength(2)
  })

  it('stops when the bound credential is revoked', async () => {
    await subscribeAna()
    await run()
    await ana.api('DELETE', `/credentials/${credentialId}`)
    await wait(15_000)
    expect(await wake()).toMatchObject({ stoppedBecause: 'credential_gone' })
    expect(await audited()).toEqual([{ host: 'api.anthropic.com', because: 'credential_gone' }])
    expect(pushes()).toHaveLength(1)
  })

  const answeredLate = async (meanwhile: () => Promise<unknown>) => {
    await subscribeAna()
    const held = service.holdNext()
    await run()
    await noteToAna()
    await (server.env.clock as TestClock).advance(45_000)
    const passing = server.wakePass()
    await held.called
    expect(service.wakes()).toHaveLength(1)
    await meanwhile()
    held.answer(401)
    await passing
  }

  it('keeps a refusal that arrives after a new setup from stopping it', async () => {
    await answeredLate(() => ana.api('PUT', '/me/desk-wake', routineSetup(credentialId)))
    expect(await wake()).toMatchObject({ stoppedBecause: null, failures: 0, lastStatus: 'never' })
    expect(await audited()).toEqual([])
    expect(pushes()).toEqual([])
  })

  it('audits nothing and tells no one when the wake was removed while it was out', async () => {
    await answeredLate(() => ana.api('DELETE', '/me/desk-wake'))
    expect(await storedRows(server, 'desk_wakes')).toEqual([])
    expect(await audited()).toEqual([])
    expect(pushes()).toEqual([])
  })

  it('stops when the stored wake no longer opens, as after the key changed', async () => {
    await T.runPromise(run_(sql`UPDATE desk_wakes SET sealed = 'v1.AAAA.AAAA.AAAA'`), server.env)
    await run()
    await noteToAna()
    await wait(45_000)
    expect(service.wakes()).toEqual([])
    expect(await wake()).toMatchObject({ stoppedBecause: 'unreadable' })
    expect(await audited()).toEqual([{ host: 'api.anthropic.com', because: 'unreadable' }])
  })
})

describe('a debate room the cloud desk takes part in', () => {
  const GRACE_5 = {
    turnsPerAgent: 2,
    totalTurns: 4,
    minutes: 60,
    turnCharacters: 300,
    graceMinutes: 5 as const,
  }

  const roomWith = async (turns: number) => {
    service = fakeService()
    server = await startCloudDeskServer(service)
    const cast = await castOf(server)
    ana = cast.ana
    await ana.api('PUT', '/me/desk-wake', routineSetup(cast.anaAgent.id))
    const id = await openedRoom(cast, { limits: GRACE_5 })
    for (let turn = 0; turn < turns; turn++)
      await (turn % 2 === 0 ? cast.anaAgent : cast.benAgent).api('POST', `/debates/${id}/turns`, {
        body: `Turn ${turn + 1}`,
      })
    cast.sleep('ana')
    return cast
  }

  it('wakes it while the room asks it for a turn, and again two minutes before each grace runs out', async () => {
    const cast = await roomWith(2)
    await run()
    await wait(MINUTE + 45_000)
    expect(fired()).toEqual([])
    await wait(45_000)
    expect(fired().map((each) => each.reason)).toEqual(['work'])
    await cast.anaAgent.api('GET', '/presence/heartbeat')
    await wait(15_000)
    expect(await wake()).toMatchObject({ lastStatus: 'online' })
    await wait(2 * MINUTE + 30_000)
    expect(fired()).toHaveLength(1)
    await wait(30_000)
    expect(fired().map((each) => each.reason)).toEqual(['work', 'debate'])
    await cast.anaAgent.api('GET', '/presence/heartbeat')
    await wait(2 * MINUTE + 45_000)
    expect(fired()).toHaveLength(2)
    await wait(30_000)
    expect(fired().map((each) => each.reason)).toEqual(['work', 'debate', 'debate'])
  })

  it('does not wake it for a room that asks nothing of it', async () => {
    await roomWith(1)
    await run()
    await wait(12 * MINUTE)
    expect(fired()).toEqual([])
  })

  it('does not wake for a room the bound credential did not opt into', async () => {
    service = fakeService()
    server = await startCloudDeskServer(service)
    const cast = await castOf(server)
    ana = cast.ana
    await connectAgent(server, ana, { name: 'Cloud desk' })
    const cloud = (await ana.api('GET', '/credentials')).json.credentials.find(
      (each: { name: string }) => each.name === 'Cloud desk',
    ).id
    await ana.api('PUT', '/me/desk-wake', routineSetup(cloud))
    const id = await openedRoom(cast, { limits: GRACE_5 })
    await cast.anaAgent.api('POST', `/debates/${id}/turns`, { body: 'Turn 1' })
    await cast.benAgent.api('POST', `/debates/${id}/turns`, { body: 'Turn 2' })
    cast.sleep('ana')
    await run()
    await wait(12 * MINUTE)
    expect(fired()).toEqual([])
  })
})
