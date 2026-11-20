import { Task as T, makeTestClock } from '@homingbird/kernel'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runAuditCommand } from '../src/audit-command.ts'
import { verifyAudit } from '../src/domain/audit.ts'
import { SESSION_COOKIE } from '../src/http/authenticate.ts'
import { buildRuntime } from '../src/runtime.ts'
import type { Connection, Database, Row } from '../src/sql/database.ts'
import { raw } from '../src/sql/query.ts'
import { tableNames } from '../src/sql/schema.ts'
import { startDovecote } from '../src/startup.ts'
import { type TestServer, keepAwake, openTestDatabase, startTestServer, testConfig } from './harness.ts'
import { groupsAndManagers } from './migration-support.ts'
import {
  FIRST_AUDIT_TABLE_ROW,
  ID,
  MINUTE,
  RETENTION_DAYS_OF_020,
  ROOM,
  T0,
  TOKEN,
  chainedAuditRows,
  databaseAt020,
  rowsOf020Tables,
} from './upgrade-support.ts'

const DIALECTS = [
  ['SQLite', 'sqlite::memory:'],
  ['PostgreSQL', process.env.HB_TEST_POSTGRES_URL],
  ['MySQL', process.env.HB_TEST_MYSQL_URL],
] as const

describe('The 0.2.0 database of these tests', () => {
  it('chains its audit rows exactly as 0.2.0 hashed the first two rows of a database it made', () => {
    const made = chainedAuditRows([
      {
        created_at: 1_700_000_000_000,
        event: 'system.migrated',
        outcome: 'success',
        actor_id: null,
        credential_id: null,
        credential_kind: null,
        client_id: null,
        target_kind: 'none',
        target_id: null,
        request_id: null,
        client_address: null,
        user_agent: null,
        detail: '{"steps":[1,2,3,4,5]}',
      },
      {
        created_at: 1_700_000_000_000,
        event: 'credential.issued',
        outcome: 'success',
        actor_id: 'mem_6p2lm1ccwqhrqwru5cro',
        credential_id: 'cred_wx4ezjwy7n41pywbd1ev',
        credential_kind: 'human',
        client_id: null,
        target_kind: 'credential',
        target_id: 'cred_wx4ezjwy7n41pywbd1ev',
        request_id: 'req_b23bvabdhph2pplngzsi',
        client_address: '127.0.0.1',
        user_agent: '',
        detail: '{"clientKind":"browser","grant":"browser","kind":"human"}',
      },
    ])
    expect(made.map(([, row]) => row.hash)).toEqual([
      '642058298c0c6d12ffac81c3ad851261b128d88ad723e479e0251f9c59cf0d5e',
      '899421003a6472967999ece00e7834cdbab482025d3683dfba659cbb3f1762f6',
    ])
  })
})

describe.each(DIALECTS)('Starting 0.3.0 on a database 0.2.0 left, on %s', (_, url) => {
  let database: Database
  let before: Readonly<Record<string, Row[]>>
  let after: Readonly<Record<string, Row[]>>
  let chainBefore: unknown
  let commandBefore: { readonly exitCode: number; readonly written: string[] }
  let started: Started
  let server: TestServer

  beforeAll(async () => {
    if (url === undefined) return
    database = await openTestDatabase(url.startsWith('sqlite:') ? null : url)
    await databaseAt020(database)
    before = await rowsOf020Tables(database)
    chainBefore = await T.runPromise(verifyAudit, { database, connection: database })
    const written: string[] = []
    const exitCode = await T.runPromise(
      runAuditCommand(['verify'], (line) => written.push(line)),
      runtimeOn(database).env,
    )
    commandBefore = { exitCode, written }
    started = await startOn(database)
    after = await rowsOf020Tables(database)
    server = await startTestServer(
      {},
      { database, ...(url.startsWith('sqlite:') ? {} : { databaseUrl: url }) },
    )
  })

  afterAll(() => server?.close())

  const read = (query: string) => T.runPromise(database.all(raw(query)))
  const as = (token: string) => (method: string, path: string, body?: unknown) =>
    server.request(method, `/api/v1${path}`, {
      ...(token.startsWith('hbh_') ? { cookie: `${SESSION_COOKIE}=${token}` } : { token }),
      ...(body !== undefined && { body }),
    })
  const auditAdded = () => after.audit_events!.slice(before.audit_events!.length)

  it.skipIf(url === undefined)(
    'applies only steps 6 and 7 at start and records them as one system.migrated event',
    () => {
      expect(started.outcome).toBe('serve')
      expect(before.schema_versions!.map((row) => Number(row.version))).toEqual([1, 2, 3, 4, 5])
      expect(after.schema_versions!.map((row) => Number(row.version))).toEqual([1, 2, 3, 4, 5, 6, 7])
      expect(auditAdded().map((row) => [row.event, JSON.parse(String(row.detail))])).toEqual([
        ['system.migrated', { steps: [6, 7] }],
        [
          'system.started',
          { version: expect.any(String), tier: expect.any(String), retentionDays: RETENTION_DAYS_OF_020 },
        ],
      ])
    },
  )

  it.skipIf(url === undefined)(
    'keeps every row 0.2.0 stored byte for byte, the first audit table included, and only adds to the chain',
    () => {
      const { schema_versions: _, audit_events: auditBefore, audit_head: __, ...keptBefore } = before
      const { schema_versions: ___, audit_events: auditAfter, audit_head: ____, ...keptAfter } = after
      expect(keptAfter).toEqual(keptBefore)
      expect(auditAfter!.slice(0, auditBefore!.length)).toEqual(auditBefore)
      expect(keptAfter.notes).toHaveLength(4)
      expect(keptAfter.debate_votes).toHaveLength(3)
      expect(keptAfter.credentials).toHaveLength(7)
      expect(keptAfter.audit_log!.map((row) => Number(row.created_at))).toEqual([
        FIRST_AUDIT_TABLE_ROW.created_at,
      ])
    },
  )

  it.skipIf(url === undefined)(
    'leaves an audit chain that verifies before the upgrade and after it, with dovecote audit verify',
    async () => {
      expect(chainBefore).toMatchObject({ ok: true, rows: 10 })
      expect(commandBefore).toEqual({
        exitCode: 3,
        written: [
          'This database is older than this Dovecote: start the server once to upgrade it, then run the command again.',
        ],
      })
      const written: string[] = []
      expect(
        await T.runPromise(
          runAuditCommand(['verify'], (line) => written.push(line)),
          started.env,
        ),
      ).toBe(0)
      expect(written).toEqual([
        expect.stringMatching(/^The audit chain holds: 12 rows, head [0-9a-f]{64}\.$/),
      ])
    },
  )

  it.skipIf(url === undefined)(
    'makes each channel exactly one unnamed channel group of its active managers in its room, and points the channel at it',
    async () => {
      expect(await groupsAndManagers(read)).toEqual({
        groups: [
          {
            id: 'grp_general00000',
            kind: 'channel',
            name: null,
            created_by: ID.ana,
            created_at: T0 + MINUTE,
          },
          { id: 'grp_lobby0000000', kind: 'channel', name: null, created_by: null, created_at: T0 },
          {
            id: 'grp_payroll00000',
            kind: 'channel',
            name: null,
            created_by: ID.ben,
            created_at: T0 + 2 * MINUTE,
          },
          {
            id: 'grp_retired00000',
            kind: 'channel',
            name: null,
            created_by: ID.dee,
            created_at: T0 + 3 * MINUTE,
          },
        ],
        members: [
          { group_id: 'grp_general00000', member_id: ID.ana },
          { group_id: 'grp_payroll00000', member_id: ID.ben },
          { group_id: 'grp_payroll00000', member_id: ID.cy },
        ],
        channels: [
          { slug: 'general', manager_group_id: 'grp_general00000' },
          { slug: 'lobby', manager_group_id: 'grp_lobby0000000' },
          { slug: 'payroll', manager_group_id: 'grp_payroll00000' },
          { slug: 'retired', manager_group_id: 'grp_retired00000' },
        ],
      })
      for (const table of ['debate_turns', 'debate_drafts', 'debate_votes'])
        expect(await read(`SELECT agent_model FROM ${table}`)).toEqual(
          Array.from({ length: 3 }, () => ({ agent_model: null })),
        )
    },
  )

  it.skipIf(url === undefined)(
    'serves the upgraded groups to each viewer as far as rule 6 lets them see the channel',
    async () => {
      const shown = async (token: string) =>
        (await as(token)('GET', '/groups')).json.groups.map((group: any) => [group.id, group.memberIds])
      expect((await as(TOKEN.cyBrowser)('GET', '/groups')).json.groups).toEqual([
        groupOf('grp_lobby0000000', [], 'lobby', T0, false),
        groupOf('grp_general00000', [ID.ana], 'general', T0 + MINUTE, false),
        groupOf('grp_payroll00000', [ID.ben, ID.cy], 'payroll', T0 + 2 * MINUTE, true),
      ])
      expect(await shown(TOKEN.anaBrowser)).toEqual([
        ['grp_lobby0000000', []],
        ['grp_general00000', [ID.ana]],
        ['grp_payroll00000', [ID.ben, ID.cy]],
        ['grp_retired00000', []],
      ])
      expect(await shown(TOKEN.anaAgent)).toEqual([
        ['grp_lobby0000000', []],
        ['grp_general00000', [ID.ana]],
        ['grp_retired00000', []],
      ])
    },
  )

  it.skipIf(url === undefined)(
    'serves the members panel of each upgraded channel with the managers its group holds',
    async () => {
      const members = async (token: string, slug: string) =>
        (await as(token)('GET', `/channels/${slug}/members`)).json
      expect(await members(TOKEN.benBrowser, 'payroll')).toEqual({
        members: expect.arrayContaining([
          { memberId: ID.ben, answering: true, manager: true },
          { memberId: ID.cy, answering: false, manager: true },
        ]),
      })
      expect((await members(TOKEN.benBrowser, 'general')).members).toEqual(
        expect.arrayContaining([
          { memberId: ID.ana, answering: true, manager: true },
          { memberId: ID.ben, answering: false, manager: false },
          { memberId: ID.cy, answering: false, manager: false },
        ]),
      )
      const retired = (await members(TOKEN.anaBrowser, 'retired')).members
      expect(retired.filter((member: { manager: boolean }) => member.manager)).toEqual([])
      expect((await as(TOKEN.anaBrowser)('GET', '/channels/payroll/members')).status).toBe(200)
      expect((await as(TOKEN.anaAgent)('GET', '/channels/payroll/members')).status).toBe(404)
      expect((await as(TOKEN.cyBrowser)('GET', '/channels/payroll')).json).toMatchObject({
        managedBy: 'grp_payroll00000',
        managing: true,
      })
    },
  )

  it.skipIf(url === undefined)(
    'lets nobody add to a private channel whose managers were all deactivated, an administrator in its room included',
    async () => {
      const added = await as(TOKEN.anaBrowser)('PUT', `/channels/retired/members/${ID.ben}`)
      expect(added.status).toBe(403)
      expect(await read("SELECT member_id FROM group_members WHERE group_id = 'grp_retired00000'")).toEqual(
        [],
      )
      expect(
        await read(
          `SELECT member_id FROM participants WHERE conversation_id = '${ROOM.retired}' ORDER BY member_id`,
        ),
      ).toEqual([{ member_id: ID.ana }, { member_id: ID.dee }])
    },
  )

  it.skipIf(url === undefined)(
    'lets the agents 0.2.0 connected take turns in a new debate room, and still shows the closed one',
    async () => {
      const ana = as(TOKEN.anaBrowser)
      const desks = [
        keepAwake(server, ID.ana, { api: as(TOKEN.anaAgent) }),
        keepAwake(server, ID.ben, { api: as(TOKEN.benAgent) }),
      ]
      try {
        const room = (
          await ana('POST', '/debates', {
            question: 'Does the March move need a freeze?',
            limits: { turnsPerAgent: 2, totalTurns: 4, minutes: 30, turnCharacters: 300 },
            memberIds: [ID.ben],
          })
        ).json
        expect((await ana('PUT', `/debates/${room.id}/agent`, { agentId: ID.anaAgent })).status).toBe(200)
        expect(
          (await as(TOKEN.benBrowser)('PUT', `/debates/${room.id}/agent`, { agentId: ID.benAgent })).status,
        ).toBe(200)
        await as(TOKEN.anaAgent)('POST', `/debates/${room.id}/turns`, {
          body: 'Yes, for a day.',
          model: 'model-a',
        })
        const taken = await as(TOKEN.benAgent)('POST', `/debates/${room.id}/turns`, {
          body: 'One day is enough.',
        })
        expect(taken.status).toBe(200)
        expect(
          taken.json.turns.map((turn: any) => [
            turn.position,
            turn.memberId,
            turn.agentName,
            turn.agentModel,
          ]),
        ).toEqual([
          [1, ID.ana, 'Ana agent', 'model-a'],
          [2, ID.ben, 'Ben agent', null],
        ])
      } finally {
        for (const stop of desks) stop()
      }
      const closed = (await as(TOKEN.cyBrowser)('GET', `/debates/${ID.debate}`)).json
      expect(closed).toMatchObject({ status: 'closed', result: { draftedBy: ID.ben } })
      expect(closed.turns.map((turn: any) => [turn.agentName, turn.body, turn.agentModel])).toEqual([
        ['Ana agent', 'The March report says the rollback failed once.', null],
        ['Ben agent', 'It was fixed in the second week; I read the follow-up.', null],
        ['Cy agent', '두 번째 주가 좋습니다.', null],
      ])
    },
  )

  it.skipIf(url === undefined)(
    'carries a note from draft to reply in a conversation 0.2.0 made, with its sessions, agents and events',
    async () => {
      const ana = as(TOKEN.anaBrowser)
      const ben = as(TOKEN.benBrowser)
      const draft = (await ana('POST', '/drafts', { to: [ID.ben], body: 'Then March it is.' })).json
      expect(draft.conversationId).toBe(ID.direct)
      await server.clock.advance(1_000)
      const note = (await ana('POST', `/drafts/${draft.id}/send`, {})).json
      expect((await as(TOKEN.benAgent)('POST', `/notes/${note.id}/pickup`)).status).toBe(200)
      const reply = (await as(TOKEN.benAgent)('POST', '/drafts', { inReplyTo: note.id, body: 'Agreed.' }))
        .json
      expect((await ben('POST', `/drafts/${reply.id}/send`, {})).status).toBe(200)
      const thread = (await ana('GET', `/conversations/${ID.direct}/notes`)).json.notes
      expect(thread.map((entry: any) => entry.id)).toEqual(
        expect.arrayContaining([ID.hello, ID.reply, note.id, reply.id]),
      )
      expect((await ana('GET', `/notes/${note.id}`)).json.receipts[0].state).toBe('replied')
      expect((await ben('GET', `/notes/${ID.generalDraft}`)).status).toBe(404)
      expect((await ben('GET', '/search?q=ready')).json.notes).toEqual([])
      expect((await as(TOKEN.deeBrowser)('GET', '/me')).status).toBe(401)
      const events = (await ben('GET', '/events/poll?after=0')).json
      expect(events.events.slice(0, 2).map((event: any) => [event.seq, event.body.type])).toEqual([
        [1, 'contact.changed'],
        [2, 'channel.changed'],
      ])
      expect(events.events.map((event: any) => event.seq)).toEqual(
        events.events.map((_: unknown, index: number) => index + 1),
      )
      expect(events.cursor).toBeGreaterThan(2)
      expect((await ana('POST', `/drafts/${ID.generalDraft}/send`, {})).json).toMatchObject({
        status: 'sent',
        body: 'Not ready to share.',
      })
      expect((await ben('GET', `/notes/${ID.generalDraft}`)).json).toMatchObject({ status: 'sent' })
    },
  )

  it.skipIf(url === undefined)('changes nothing but the record of the start on a second start', async () => {
    const everything = () => storedEverything(database)
    const served = await everything()
    const again = await startOn(database)
    const restarted = await everything()
    expect(again.outcome).toBe('serve')
    const { audit_events: auditServed, audit_head: _, ...keptServed } = served
    const { audit_events: auditRestarted, audit_head: __, ...keptRestarted } = restarted
    expect(keptRestarted).toEqual(keptServed)
    expect(auditRestarted!.slice(0, auditServed!.length)).toEqual(auditServed)
    expect(auditRestarted!.slice(auditServed!.length).map((row) => row.event)).toEqual(['system.started'])
  })
})

describe.each(DIALECTS.filter(([name]) => name !== 'MySQL'))(
  'A start of 0.3.0 that loses its connection during the upgrade, on %s',
  (_, url) => {
    it.skipIf(url === undefined)(
      'keeps each step whole, leaves the rows of 0.2.0 as they were, and the next start finishes the upgrade',
      async () => {
        const database = await openTestDatabase(url?.startsWith('sqlite:') ? null : url)
        try {
          await databaseAt020(database)
          const before = await rowsOf020Tables(database)
          const cut = await T.run(
            startDovecote([], PORT, () => {}),
            runtimeOn(losingConnectionAt(database, /^ALTER TABLE debate_drafts ADD COLUMN agent_model/)).env,
          )
          expect(cut).toMatchObject({ _tag: 'Err', error: { _tag: 'Die' } })
          const read = (query: string) => T.runPromise(database.all(raw(query)))
          expect(
            (await read('SELECT version FROM schema_versions')).map((row) => Number(row.version)).sort(),
          ).toEqual([1, 2, 3, 4, 5, 6])
          expect(await read('SELECT agent_model FROM debate_turns').catch(() => 'no agent model')).toBe(
            'no agent model',
          )
          const { schema_versions: __, ...kept } = await rowsOf020Tables(database)
          const { schema_versions: ___, ...keptBefore } = before
          expect(kept).toEqual(keptBefore)
          const finished = await startOn(database)
          expect(finished.outcome).toBe('serve')
          expect(
            (await read('SELECT version FROM schema_versions')).map((row) => Number(row.version)).sort(),
          ).toEqual([1, 2, 3, 4, 5, 6, 7])
          expect((await groupsAndManagers(read)).members).toEqual([
            { group_id: 'grp_general00000', member_id: ID.ana },
            { group_id: 'grp_payroll00000', member_id: ID.ben },
            { group_id: 'grp_payroll00000', member_id: ID.cy },
          ])
          expect(await T.runPromise(verifyAudit, finished.env)).toMatchObject({ ok: true })
        } finally {
          await T.runPromise(database.close)
        }
      },
    )
  },
)

interface Started {
  readonly outcome: { readonly exitCode: number } | 'serve'
  readonly env: ReturnType<typeof buildRuntime>['env']
}

const PORT = 8080
const STARTED_AT = 1_700_000_000_000

const runtimeOn = (database: Database) =>
  buildRuntime({ config: testConfig(), database, clock: makeTestClock(STARTED_AT), write: () => {} })

/** What `dovecote` does when it starts on a database, before it listens. */
const startOn = async (database: Database): Promise<Started> => {
  const { env } = runtimeOn(database)
  return {
    outcome: await T.runPromise(
      startDovecote([], PORT, () => {}),
      env,
    ),
    env,
  }
}

const groupOf = (id: string, memberIds: string[], slug: string, createdAt: number, mayAdd: boolean) => ({
  id,
  kind: 'channel',
  name: null,
  memberIds,
  channels: [slug],
  mayAdd,
  mayRemove: mayAdd,
  createdAt,
})

const storedEverything = async (database: Database): Promise<Readonly<Record<string, Row[]>>> => {
  const tables: Record<string, Row[]> = {}
  for (const table of tableNames())
    tables[table] = [...(await T.runPromise(database.all(raw(`SELECT * FROM ${table}`))))].sort(
      table === 'audit_events'
        ? (left, right) => Number(left.id) - Number(right.id)
        : (left, right) => (JSON.stringify(left) < JSON.stringify(right) ? -1 : 1),
    )
  return tables
}

/** A database whose connection drops on the first statement that matches, inside a transaction or not. */
const losingConnectionAt = (database: Database, when: RegExp): Database => {
  const losing = (connection: Connection): Connection => ({
    dialect: connection.dialect,
    all: (query) => connection.all(query),
    run: (query) =>
      when.test(query.text) ? T.die(new Error('the connection was lost')) : connection.run(query),
  })
  return {
    ...database,
    ...losing(database),
    transaction: (body) => database.transaction((connection) => body(losing(connection))),
  }
}
