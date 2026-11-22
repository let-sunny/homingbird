import { Task as T } from '@homingbird/kernel'
import { AUDIT_TARGET_ID_MAX, type RouteName, contract } from '@homingbird/protocol'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { GENESIS, canonicalJson, recordAudit, verifyAudit, verifyChain } from '../src/domain/audit.ts'
import { flushAttempts } from '../src/domain/denied-attempts.ts'
import { transact } from '../src/events/events.ts'
import { handleRequest } from '../src/http/app.ts'
import { chainHeadPass, housekeepingPass, refusedAttempts } from '../src/runtime.ts'
import { run } from '../src/sql/database.ts'
import { insertInto, sql } from '../src/sql/query.ts'
import {
  type TestServer,
  asShown,
  connectAgent,
  everyStoredValue,
  startTestServer,
  storedRows,
} from './harness.ts'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const TOKEN_SHAPED = /hb[har]_[A-Za-z0-9_-]{20,}/

let server: TestServer
afterEach(() => server?.close())

const scenario = async (overrides: Record<string, string> = {}) => {
  server = await startTestServer(overrides)
  const ana = await server.signIn('ana@example.com', 'Ana')
  const ben = await server.signIn('ben@example.com', 'Ben')
  const anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
  const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'audited question' }))
    .json
  await anaAgent.api('PATCH', `/drafts/${draft.id}`, { body: 'audited question v2' })
  const sent = (
    await ana.api(
      'POST',
      `/drafts/${draft.id}/send`,
      await asShown(ana, draft.id, { body: 'audited question final' }),
    )
  ).json
  await ben.api('POST', `/notes/${sent.id}/read`)
  const reply = (await ben.api('POST', '/drafts', { inReplyTo: sent.id, body: 'audited reply' })).json
  await ben.api('POST', `/drafts/${reply.id}/discard`)
  await anaAgent.api('POST', `/drafts/${draft.id}/send`, await asShown(anaAgent, draft.id))
  await ana.api('PATCH', '/me', { profile: 'Billing' })
  await ana.api('PUT', `/blocks/${ben.me.member.id}`)
  await server.request('POST', '/auth/logout', { cookie: ben.cookie })
  return { ana, ben, anaAgent, sent, reply }
}

const rows = async () => storedRows(server, 'audit_events')

const saveRetention = (days: number | null) =>
  T.runPromise(
    T.gen(function* () {
      yield* run(sql`DELETE FROM settings WHERE name = ${'organization'}`)
      yield* run(
        insertInto('settings', {
          name: 'organization',
          value: JSON.stringify({ allowedDomains: [], contactMode: 'open', auditRetentionDays: days }),
        }),
      )
    }),
    server.env,
  )
const events = async () => (await rows()).map((row) => String(row.event))
const detailOf = (row: Readonly<Record<string, unknown>>) => JSON.parse(String(row.detail))

describe('the audit trail', () => {
  it('records who changed what, by ids and enums, and never a note’s content', async () => {
    const { ana, ben, sent, reply } = await scenario()
    expect(await events()).toEqual([
      'credential.issued',
      'authn.signed_in',
      'credential.issued',
      'authn.signed_in',
      'credential.device_decided',
      'credential.issued',
      'note.approved',
      'note.discarded',
      'member.profile_changed',
      'contact.blocked',
      'authn.signed_out',
    ])
    const stored = await rows()
    expect(stored.find((row) => row.event === 'note.approved')).toMatchObject({
      outcome: 'success',
      actor_id: ana.me.member.id,
      credential_kind: 'human',
      target_kind: 'note',
      target_id: sent.id,
    })
    expect(detailOf(stored.find((row) => row.event === 'note.approved')!)).toEqual({
      conversationId: sent.conversationId,
      edited: true,
    })
    expect(stored.find((row) => row.event === 'note.discarded')).toMatchObject({
      actor_id: ben.me.member.id,
      target_id: reply.id,
    })
    expect(detailOf(stored.find((row) => row.event === 'member.profile_changed')!)).toEqual({
      fields: ['profile'],
    })
    expect(JSON.stringify(stored)).not.toMatch(/audited|Billing|example\.com/)
  })

  it('keeps the client address and user agent only on sign-in and credential rows', async () => {
    await scenario()
    for (const row of await rows())
      expect([row.event, row.client_address !== null]).toEqual([
        row.event,
        ['credential.issued', 'authn.signed_in', 'authn.signed_out'].includes(String(row.event)),
      ])
  })

  it('records no read and no activity: reading, drafting, editing and seeing a draft keep no row', async () => {
    const { ana } = await scenario()
    const ben = await server.signIn('ben@example.com', 'Ben')
    const cy = await server.signIn('cy@example.com', 'Cy')
    const agent = await connectAgent(server, ben)
    const cyAgent = await connectAgent(server, cy)
    const before = (await rows()).length
    for (const name of Object.keys(contract) as RouteName[])
      if (contract[name].method === 'GET' && !contract[name].path.includes(':'))
        await ana.api('GET', contract[name].path)
    const draft = (await agent.api('POST', '/drafts', { to: [cy.me.member.id], body: 'seen once' })).json
    await agent.api('PATCH', `/drafts/${draft.id}`, { body: 'seen twice' })
    expect((await ben.api('POST', `/drafts/${draft.id}/seen`)).status).toBe(200)
    const sent = (await ben.api('POST', `/drafts/${draft.id}/send`, await asShown(ben, draft.id))).json
    const afterSend = (await rows()).length
    await cy.api('POST', `/notes/${sent.id}/read`)
    await cyAgent.api('POST', `/notes/${sent.id}/pickup`)
    expect(afterSend).toBe(before + 1)
    expect((await rows()).length).toBe(afterSend)
    expect(await events()).not.toContain('drafts.seen')
  })

  it('rolls the row back together with a failed action', async () => {
    const { ana } = await scenario()
    const before = (await rows()).length
    expect(
      (await ana.api('POST', '/drafts/note_doesnotexist00/send', await asShown(ana, 'note_doesnotexist00')))
        .status,
    ).toBe(404)
    expect((await rows()).length).toBe(before)
  })

  it('never holds a credential, anywhere in the database or the operational log', async () => {
    const { ana, ben, anaAgent } = await scenario({
      HB_LOGS: 'operational=debug,requests=on,auditCopy=on',
    })
    const stored = await everyStoredValue(server)
    const logged = server.logged.join('\n')
    for (const token of [ana.token, ben.token, anaAgent.token]) {
      expect(stored.includes(token)).toBe(false)
      expect(logged.includes(token)).toBe(false)
    }
    expect(stored).not.toMatch(TOKEN_SHAPED)
    expect(logged).not.toMatch(TOKEN_SHAPED)
    expect(logged).not.toMatch(/ana@example\.com|audited/)
  })

  it('keeps every note, basis, principle and turn text out of the trail and the log', async () => {
    server = await startTestServer({ HB_LOGS: 'operational=debug,requests=on,auditCopy=on' })
    const ana = await server.signIn('ana@example.com', 'Ana')
    const ben = await server.signIn('ben@example.com', 'Ben')
    const agent = await connectAgent(server, ana)
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[a-z]{6,12}$/), async (word) => {
        const marker = `zq${word}`
        const draft = (
          await agent.api('POST', '/drafts', {
            to: [ben.me.member.id],
            body: `${marker} body`,
            basis: marker,
          })
        ).json
        await ana.api(
          'POST',
          `/drafts/${draft.id}/send`,
          await asShown(ana, draft.id, { body: `${marker} sent` }),
        )
        const principle = (
          await ana.api('POST', '/principles', { topic: marker, rule: `${marker} rule`, place: null })
        ).json
        await ana.api('PATCH', `/principles/${principle.id}`, { rule: `${marker} again` })
        await ana.api('DELETE', `/principles/${principle.id}`)
        await ana.api('PATCH', '/me', { profile: marker })
        const recorded = `${JSON.stringify(await rows())}\n${server.logged.join('\n')}`
        expect(recorded).not.toContain(marker)
      }),
      { numRuns: 8 },
    )
  })
})

describe('refused attempts', () => {
  it('coalesce into one row per credential and route a minute, with a count', async () => {
    const { anaAgent, sent } = await scenario()
    const before = (await events()).filter((event) => event === 'authz.denied').length
    expect(before).toBe(0)
    for (let attempt = 0; attempt < 49; attempt++)
      await anaAgent.api('POST', `/drafts/${sent.id}/send`, await asShown(anaAgent, sent.id))
    await T.runPromise(flushAttempts('due'), server.env)
    expect((await events()).filter((event) => event === 'authz.denied')).toEqual([])
    await server.clock.advance(60_000)
    await T.runPromise(flushAttempts('due'), server.env)
    const denied = (await rows()).filter((row) => row.event === 'authz.denied')
    expect(denied).toHaveLength(1)
    expect(denied[0]).toMatchObject({ outcome: 'denied', target_kind: 'route', target_id: 'drafts.send' })
    expect(detailOf(denied[0]!).count).toBe(50)
    await anaAgent.api('POST', `/drafts/${sent.id}/discard`)
    await server.clock.advance(60_000)
    await anaAgent.api('POST', `/drafts/${sent.id}/discard`)
    const discards = (await rows()).filter((row) => row.target_id === 'drafts.discard')
    expect(discards.map((row) => detailOf(row).count)).toEqual([1])
  })
})

describe('the hash chain', () => {
  it('verifies after writes and after a retention purge', async () => {
    await scenario()
    expect(await T.runPromise(verifyAudit, server.env)).toMatchObject({ ok: true, rows: 11 })
    await server.clock.advance(401 * DAY)
    await server.signIn('cy@example.com', 'Cy')
    await T.runPromise(housekeepingPass, server.env)
    const left = await rows()
    expect(left.map((row) => row.event)).toEqual([
      'credential.issued',
      'authn.signed_in',
      'audit.retention_purged',
    ])
    expect(detailOf(left[2]!)).toMatchObject({ removed: 11, earlierRemoved: 0 })
    expect(await T.runPromise(verifyAudit, server.env)).toMatchObject({ ok: true, rows: 3 })
  })

  it('fails after a row is changed', async () => {
    await scenario()
    const [, second] = await rows()
    await T.runPromise(
      run(sql`UPDATE audit_events SET detail = ${'{"edited":false}'} WHERE id = ${second!.id}`),
      server.env,
    )
    expect(await T.runPromise(verifyAudit, server.env)).toEqual({
      ok: false,
      id: Number(second!.id),
      problem: 'its hash does not match its content',
    })
  })

  it('fails after a row in the middle or at the end is deleted', async () => {
    await scenario()
    const stored = await rows()
    await T.runPromise(run(sql`DELETE FROM audit_events WHERE id = ${stored[3]!.id}`), server.env)
    expect(await T.runPromise(verifyAudit, server.env)).toMatchObject({
      ok: false,
      id: Number(stored[4]!.id),
      problem: 'its link does not match the row before it',
    })
    await T.runPromise(run(sql`DELETE FROM audit_events WHERE id >= ${stored[3]!.id}`), server.env)
    expect(await T.runPromise(verifyAudit, server.env)).toMatchObject({
      ok: false,
      problem: 'the chain head names a row that is missing',
    })
  })

  it('verifies an empty trail, and writes its head to the operational log', async () => {
    server = await startTestServer()
    expect(await T.runPromise(verifyAudit, server.env)).toEqual({ ok: true, rows: 0, head: GENESIS })
    await server.signIn('ana@example.com')
    await T.runPromise(chainHeadPass, server.env)
    const line = JSON.parse(server.logged.at(-1)!)
    expect(line).toMatchObject({ eventName: 'audit.chain_head', attributes: { id: 2 } })
    const verdict = await T.runPromise(verifyAudit, server.env)
    expect(verdict.ok && verdict.head).toBe(line.attributes.hash)
  })

  it('writes the same canonical JSON whatever order the keys came in', async () => {
    server = await startTestServer()
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"e":0,"f":1}]},"b":1}',
    )
  })
})

describe('retention', () => {
  it('keeps rows 400 days by default, then purges them and the rows of the first audit table', async () => {
    await scenario()
    await T.runPromise(
      run(
        insertInto('audit_log', {
          created_at: server.clock.now(),
          actor_id: null,
          credential_id: null,
          credential_kind: null,
          action: 'drafts.send',
          target: null,
          detail: '{"note":{"body":"old content"}}',
        }),
      ),
      server.env,
    )
    await server.clock.advance(399 * DAY)
    await T.runPromise(housekeepingPass, server.env)
    expect((await rows()).length).toBe(11)
    await server.clock.advance(2 * DAY)
    await T.runPromise(housekeepingPass, server.env)
    expect(await events()).toEqual(['audit.retention_purged'])
    expect(await storedRows(server, 'audit_log')).toEqual([])
    expect(detailOf((await rows())[0]!)).toMatchObject({ removed: 11, earlierRemoved: 1 })
  })

  it('follows HB_AUDIT_RETENTION_DAYS', async () => {
    await scenario({ HB_AUDIT_RETENTION_DAYS: '90' })
    await server.clock.advance(91 * DAY)
    await T.runPromise(housekeepingPass, server.env)
    expect(await events()).toEqual(['audit.retention_purged'])
  })

  it('keeps rows as long as an administrator saved before the variable existed, when that is longer', async () => {
    await scenario()
    await saveRetention(700)
    await server.clock.advance(401 * DAY)
    await T.runPromise(housekeepingPass, server.env)
    expect(await events()).not.toContain('audit.retention_purged')
    await server.clock.advance(300 * DAY)
    await T.runPromise(housekeepingPass, server.env)
    expect(await events()).toEqual(['audit.retention_purged'])
  })

  it('never purges a trail an administrator chose to keep forever, even after saving the settings again', async () => {
    const { ana } = await scenario()
    await saveRetention(null)
    const settings = (await ana.api('GET', '/admin/settings')).json
    expect((await ana.api('PUT', '/admin/settings', { ...settings, contactMode: 'contacts' })).status).toBe(
      200,
    )
    await server.clock.advance(5000 * DAY)
    await T.runPromise(housekeepingPass, server.env)
    expect(await events()).not.toContain('audit.retention_purged')
    expect((await rows()).length).toBeGreaterThan(10)
  })

  it('keeps the saved retention when an administrator saves the settings again', async () => {
    const { ana } = await scenario()
    await saveRetention(700)
    const settings = (await ana.api('GET', '/admin/settings')).json
    expect((await ana.api('PUT', '/admin/settings', { ...settings, contactMode: 'contacts' })).status).toBe(
      200,
    )
    await server.clock.advance(401 * DAY)
    await T.runPromise(housekeepingPass, server.env)
    expect(await events()).not.toContain('audit.retention_purged')
  })

  it('keeps the default over a shorter saved retention, and HB_AUDIT_RETENTION_DAYS over either', async () => {
    await scenario()
    await saveRetention(120)
    await server.clock.advance(121 * DAY)
    await T.runPromise(housekeepingPass, server.env)
    expect(await events()).not.toContain('audit.retention_purged')
    await server.close()
    await scenario({ HB_AUDIT_RETENTION_DAYS: '100' })
    await saveRetention(700)
    await server.clock.advance(101 * DAY)
    await T.runPromise(housekeepingPass, server.env)
    expect(await events()).toEqual(['audit.retention_purged'])
  })
})

describe('request ids', () => {
  it('answers every request with an X-Request-Id that its audit row and log line share', async () => {
    server = await startTestServer({ HB_LOGS: 'requests=on' })
    const ana = await server.signIn('ana@example.com')
    const health = await server.request('GET', '/healthz')
    expect(health.headers['x-request-id']).toMatch(/^req_[0-9a-z]{20}$/)
    const changed = await ana.api('PATCH', '/me', { profile: 'x' })
    const id = changed.headers['x-request-id']
    const row = (await rows()).find((each) => each.event === 'member.profile_changed')
    expect(row?.request_id).toBe(id)
    const line = server.logged
      .map((each) => JSON.parse(each))
      .find((each) => each.attributes.requestId === id)
    expect(line).toMatchObject({
      eventName: 'http.request',
      attributes: { route: 'me.update', method: 'PATCH', status: 200 },
    })
    expect(health.headers['x-request-id']).not.toBe(id)
  })

  it('logs a request to the A2A endpoint under the a2a area with its attributes', async () => {
    server = await startTestServer({ HB_LOGS: 'requests=on' })
    const answered = await server.request('POST', '/a2a', { body: {} })
    const line = server.logged
      .map((each) => JSON.parse(each))
      .find((each) => each.attributes.requestId === answered.headers['x-request-id'])
    expect(line).toMatchObject({
      eventName: 'http.request',
      attributes: { route: 'a2a', method: 'POST', status: answered.status },
    })
    expect(line.attributes.invalidAttributes).toBeUndefined()
  })

  it('logs a request that dies by the defect’s name, with the id it answered', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    const agent = await connectAgent(server, ana)
    const dying = {
      ...server.env,
      rateLimiter: {
        allow: () => {
          throw new RangeError(`secret ${agent.token}`)
        },
        waitMs: () => 0,
      },
    }
    const exit = await T.run(
      handleRequest({
        method: 'POST',
        path: '/api/v1/drafts',
        query: new URLSearchParams('code=abc'),
        headers: { authorization: `Bearer ${agent.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ to: [ana.me.member.id], body: 'x' }),
        remoteAddress: '127.0.0.1',
        disconnected: new AbortController().signal,
      }),
      dying,
    )
    expect(exit._tag === 'Ok' && exit.value.status).toBe(500)
    const id = exit._tag === 'Ok' ? exit.value.headers['x-request-id'] : null
    const failed = server.logged
      .map((each) => JSON.parse(each))
      .find((each) => each.eventName === 'http.request_failed')
    expect(failed).toMatchObject({
      severityText: 'ERROR',
      attributes: { route: 'drafts.create', method: 'POST', defect: 'RangeError', requestId: id },
    })
    expect(server.logged.join('\n')).not.toContain(agent.token)
  })
})

describe('HB_LOGS', () => {
  const lines = () => server.logged.map((each) => JSON.parse(each))

  it('audit=off records nothing', async () => {
    await scenario({ HB_LOGS: 'audit=off' })
    expect(await rows()).toEqual([])
  })

  it('audit=security keeps sign-in, credentials and refusals, not approvals or profiles', async () => {
    await scenario({ HB_LOGS: 'audit=security' })
    expect(new Set(await events())).toEqual(
      new Set(['credential.issued', 'authn.signed_in', 'credential.device_decided', 'authn.signed_out']),
    )
  })

  it('operational=off writes no line, and error writes no information line', async () => {
    await scenario({ HB_LOGS: 'operational=off' })
    expect(server.logged).toEqual([])
    await server.close()
    await scenario({ HB_LOGS: 'operational=error' })
    expect(server.logged).toEqual([])
  })

  it('requests=off writes no request line; on writes one per request', async () => {
    await scenario()
    expect(lines().filter((line) => line.eventName === 'http.request')).toEqual([])
    await server.close()
    await scenario({ HB_LOGS: 'requests=on' })
    const requests = lines().filter((line) => line.eventName === 'http.request')
    expect(requests.length).toBeGreaterThan(10)
    expect(JSON.stringify(requests)).not.toMatch(/\?|code=|state=/)
  })

  it('auditCopy=on copies each row to stdout without its detail, and HB_AUDIT_STDOUT=1 means the same', async () => {
    await scenario({ HB_LOGS: 'auditCopy=on' })
    const copies = lines().filter((line) => line.eventName === 'audit.copy')
    expect(copies.map((line) => line.attributes.event)).toEqual(await events())
    expect(copies.every((line) => !('detail' in line.attributes))).toBe(true)
    await server.close()
    await scenario({ HB_AUDIT_STDOUT: '1' })
    expect(lines().filter((line) => line.eventName === 'audit.copy').length).toBe((await rows()).length)
    await server.close()
    await scenario()
    expect(lines().filter((line) => line.eventName === 'audit.copy')).toEqual([])
  })
})
describe('refused tokens', () => {
  it('coalesce into one row a minute per credential, or per token hash, and one warning a minute per address', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    const agent = await connectAgent(server, ana)
    const [credential] = (await ana.api('GET', '/credentials')).json.credentials.filter(
      (each: { kind: string }) => each.kind === 'agent',
    )
    await ana.api('DELETE', `/credentials/${credential.id}`)
    for (let attempt = 0; attempt < 3; attempt++) expect((await agent.api('GET', '/me')).status).toBe(401)
    const forged = 'hba_forgedforgedforgedforgedforged'
    expect((await server.request('GET', '/api/v1/me', { token: forged })).status).toBe(401)
    await server.clock.advance(60_000)
    await T.runPromise(flushAttempts('due'), server.env)
    const refused = (await rows()).filter((row) => row.event === 'authn.token_refused')
    expect(refused.map((row) => [row.target_id, row.outcome, detailOf(row).count])).toEqual([
      [credential.id, 'denied', 3],
      [null, 'denied', 1],
    ])
    expect(detailOf(refused[1]!).tokenHash).toMatch(/^[0-9a-f]{16}$/)
    const stored = `${JSON.stringify(await rows())}\n${server.logged.join('\n')}`
    expect(stored).not.toContain(agent.token)
    expect(stored).not.toContain(forged)
    const burst = server.logged
      .map((line) => JSON.parse(line))
      .find((line) => line.eventName === 'authn.refused_burst')
    expect(burst).toMatchObject({
      severityText: 'WARN',
      attributes: { clientAddress: '127.0.0.0/24', count: 4 },
    })
  })

  it('are written within seconds of their minute, and all of them at shutdown', async () => {
    server = await startTestServer()
    const running = T.runFork(refusedAttempts, server.env)
    await server.request('GET', '/api/v1/me', { token: 'hba_nobodynobodynobodynobodynobody' })
    await server.clock.advance(50_000)
    expect(await events()).toEqual([])
    await server.clock.advance(20_000)
    expect(await events()).toEqual(['authn.token_refused'])
    await running.interrupt()
    await server.request('GET', '/api/v1/me', { token: 'hba_nobodynobodynobodynobodynobody' })
    await T.runPromise(flushAttempts('all'), server.env)
    expect(await events()).toEqual(['authn.token_refused', 'authn.token_refused'])
  })
})

describe('a detail that does not fit its schema', () => {
  it('keeps the row without the detail, says so, and never fails the action', async () => {
    server = await startTestServer()
    await T.runPromise(
      transact(
        recordAudit('note.discarded', {
          targetId: 'x'.repeat(500),
          detail: { conversationId: 'not an id' } as never,
        }),
      ),
      server.env,
    )
    const [row] = await rows()
    expect([row!.event, row!.detail, String(row!.target_id).length]).toEqual([
      'note.discarded',
      '{"invalidDetail":true}',
      AUDIT_TARGET_ID_MAX,
    ])
    expect(JSON.parse(server.logged.at(-1)!)).toMatchObject({
      eventName: 'audit.invalid_detail',
      attributes: { event: 'note.discarded' },
    })
    expect(await T.runPromise(verifyAudit, server.env)).toMatchObject({ ok: true, rows: 1 })
  })
})

describe('the client of a row', () => {
  it('cuts a client address and a user agent to what their columns hold', async () => {
    server = await startTestServer()
    await T.runPromise(
      T.provide({ client: { address: `10.0.0.1${'9'.repeat(1000)}`, userAgent: 'u'.repeat(1000) } })(
        transact(recordAudit('authn.signed_out', { actorId: null, detail: {} })),
      ),
      server.env,
    )
    const [row] = await rows()
    expect([String(row!.client_address).length, String(row!.user_agent).length]).toEqual([400, 200])
    expect(String(row!.client_address)).toMatch(/^10\.0\.0\.1/)
    expect(await T.runPromise(verifyAudit, server.env)).toMatchObject({ ok: true, rows: 1 })
  })
})

describe('verifying while the server writes', () => {
  it('stops at the head it read first, and a purge meanwhile reports no break', async () => {
    await scenario()
    const original = server.env.connection
    let pages = 0
    const interleaving = {
      ...original,
      all: (query: Parameters<typeof original.all>[0]) =>
        T.gen(function* () {
          if (query.text.includes('FROM audit_events WHERE id >') && ++pages === 2) {
            yield* T.promise(() => server.clock.advance(401 * DAY))
            yield* T.promise(() => server.signIn('cy@example.com'))
            yield* T.promise(() => T.runPromise(housekeepingPass, server.env))
          }
          return yield* original.all(query)
        }),
    }
    const verdict = await T.runPromise(verifyChain(2), { ...server.env, connection: interleaving })
    expect(verdict).toMatchObject({ ok: true })
    expect(await T.runPromise(verifyAudit, server.env)).toMatchObject({ ok: true, rows: 3 })
  })
})
