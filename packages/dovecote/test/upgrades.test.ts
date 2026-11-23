import { Task as T, makeTestClock } from '@homingbird/kernel'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runAuditCommand } from '../src/audit-command.ts'
import { verifyAudit } from '../src/domain/audit.ts'
import { SESSION_COOKIE } from '../src/http/authenticate.ts'
import { buildRuntime } from '../src/runtime.ts'
import type { Connection, Database, Row } from '../src/sql/database.ts'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { AUDIT_TRAIL } from '../src/sql/migrations/audit-trail-step.ts'
import { DEBATE_MODEL } from '../src/sql/migrations/debate-model-step.ts'
import { DEBATES } from '../src/sql/migrations/debates-step.ts'
import { GROUPS } from '../src/sql/migrations/groups-step.ts'
import { RESULT_VOTES } from '../src/sql/migrations/result-votes-step.ts'
import { raw } from '../src/sql/query.ts'
import { tableNames } from '../src/sql/schema.ts'
import { startDovecote } from '../src/startup.ts'
import { SERVER_VERSION } from '../src/version.ts'
import { asRead, issueAgentCredential } from './channel-agent-support.ts'
import { migrationTimeout } from './dialect-support.ts'
import {
  type Session,
  type TestServer,
  asShown,
  keepAwake,
  openTestDatabase,
  startTestServer,
  testConfig,
} from './harness.ts'
import { groupsAndManagers } from './migration-support.ts'
import {
  AUDIT_TABLE_ROWS,
  DAY,
  ID,
  MINUTE,
  RELEASES,
  RETENTION_DAYS,
  ROOM,
  T0,
  TEAM,
  TOKEN,
  UPGRADES,
  chainedAuditRows,
  databaseAt,
  hasStep,
  rowsOfEveryTable,
  rowsOfReleaseTables,
  stepsAfter,
} from './upgrade-support.ts'

describe('The releases these tests upgrade from', () => {
  it('are in release order, each at no fewer steps than the one before and no more than this build has', () => {
    for (const [index, later] of RELEASES.entries()) {
      const earlier = RELEASES[index - 1]
      if (earlier === undefined) continue
      expect(compareVersions(earlier.version, later.version)).toBe(-1)
      expect(earlier.steps).toBeLessThanOrEqual(later.steps)
    }
    expect(RELEASES[0]).toEqual({ version: '0.1.0', steps: 1 })
    expect(RELEASES.at(-1)!.steps).toBeLessThanOrEqual(MIGRATIONS.length)
    expect(RELEASES.map((release) => release.version)).toContain(SERVER_VERSION)
  })

  it('chain their audit rows exactly as 0.2.0 hashed the first two rows of a database it made', () => {
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

describe.each(UPGRADES)('Starting this Dovecote on a database %s left, on %s', (_, __, release, url) => {
  const timeout = migrationTimeout(url)

  let database: Database
  let before: Readonly<Record<string, Row[]>>
  let after: Readonly<Record<string, Row[]>>
  let kindsAfter: ReadonlyArray<Row>
  let trailAfter: Readonly<Record<string, Row[]>>
  let chainBefore: unknown
  let commandBefore: { readonly exitCode: number; readonly written: string[] }
  let started: Started
  let server: TestServer

  beforeAll(async () => {
    if (url === undefined) return
    database = await openTestDatabase(url.startsWith('sqlite:') ? null : url)
    await databaseAt(release, database)
    before = await rowsOfReleaseTables(release, database)
    chainBefore = hasStep(release, AUDIT_TRAIL)
      ? await T.runPromise(verifyAudit, { database, connection: database })
      : null
    const written: string[] = []
    const exitCode = await T.runPromise(
      runAuditCommand(['verify'], (line) => written.push(line)),
      runtimeOn(database).env,
    )
    commandBefore = { exitCode, written }
    started = await startOn(database)
    after = await rowsOfReleaseTables(release, database)
    trailAfter = await rowsOfEveryTable(database)
    kindsAfter = await T.runPromise(database.all(raw('SELECT DISTINCT kind FROM members')))
    server = await startTestServer(
      { HB_FEATURES: 'channelAgents=on' },
      { database, ...(url.startsWith('sqlite:') ? {} : { databaseUrl: url }) },
    )
  }, timeout)

  afterAll(() => server?.close())

  const read = (query: string) => T.runPromise(database.all(raw(query)))
  const as = (token: string) => (method: string, path: string, body?: unknown) =>
    server.request(method, `/api/v1${path}`, {
      ...(token.startsWith('hbh_') ? { cookie: `${SESSION_COOKIE}=${token}` } : { token }),
      ...(body !== undefined && { body }),
    })
  const auditBefore = () => before.audit_events ?? []
  const auditAdded = () => trailAfter.audit_events!.slice(auditBefore().length)
  const purgesFirstAuditTable = !hasStep(release, AUDIT_TRAIL)

  it.skipIf(url === undefined)(
    'applies only the steps the release lacks at start, records them as one system.migrated event, and makes every member a person',
    () => {
      expect(started.outcome).toBe('serve')
      expect(before.schema_versions!.map((row) => Number(row.version))).toEqual(stepsThrough(release.steps))
      expect(after.schema_versions!.map((row) => Number(row.version))).toEqual(
        stepsThrough(MIGRATIONS.length),
      )
      expect(kindsAfter).toEqual([{ kind: 'person' }])
      expect(auditAdded().map((row) => [row.event, JSON.parse(String(row.detail))])).toEqual([
        ...(stepsAfter(release).length > 0 ? [['system.migrated', { steps: stepsAfter(release) }]] : []),
        ...(purgesFirstAuditTable ? [['audit.legacy_purged', { removed: 1, because: 'upgrade' }]] : []),
        [
          'system.started',
          { version: SERVER_VERSION, tier: expect.any(String), retentionDays: RETENTION_DAYS },
        ],
      ])
    },
    timeout,
  )

  it.skipIf(url === undefined)(
    'keeps every row the release stored byte for byte, and only adds to the audit chain and the settings',
    () => {
      const { schema_versions: _, audit_events: ___, audit_head: __, ...keptBefore } = before
      const { schema_versions: ____, audit_events: _____, audit_head: ______, ...keptAfter } = after
      const cutoff = STARTED_AT - RETENTION_DAYS * DAY
      expect({
        ...keptAfter,
        settings: keptAfter.settings!.filter((row) => row.name !== 'analytics-key'),
      }).toEqual({
        ...keptBefore,
        settings: keptBefore.settings!.filter((row) => row.name !== 'analytics-key'),
        audit_log: keptBefore.audit_log!.filter(
          (row) => !purgesFirstAuditTable || Number(row.created_at) >= cutoff,
        ),
      })
      expect(keptAfter.settings!.filter((row) => row.name === 'analytics-key')).toHaveLength(1)
      expect(trailAfter.audit_events!.slice(0, auditBefore().length)).toEqual(auditBefore())
      expect(keptBefore.notes).toHaveLength(4)
      expect(keptBefore.credentials).toHaveLength(7)
      expect(keptAfter.audit_log!.map((row) => Number(row.created_at))).toEqual([
        ...(purgesFirstAuditTable ? [] : [AUDIT_TABLE_ROWS.old.created_at]),
        AUDIT_TABLE_ROWS.recent.created_at,
      ])
    },
    timeout,
  )

  it.skipIf(url === undefined)(
    'leaves an audit chain that verifies before the upgrade, when the release had one, and after it',
    async () => {
      if (hasStep(release, AUDIT_TRAIL)) expect(chainBefore).toMatchObject({ ok: true })
      expect(commandBefore).toEqual(
        stepsAfter(release).length === 0
          ? { exitCode: 0, written: [expect.stringMatching(/^The audit chain holds/)] }
          : {
              exitCode: 3,
              written: [
                'This database is older than this Dovecote: start the server once to upgrade it, then run the command again.',
              ],
            },
      )
      const written: string[] = []
      expect(
        await T.runPromise(
          runAuditCommand(['verify'], (line) => written.push(line)),
          started.env,
        ),
      ).toBe(0)
      expect(written).toEqual([
        `The audit chain holds: ${trailAfter.audit_events!.length} rows, head ${trailAfter.audit_head![0]!.hash}.`,
      ])
    },
    timeout,
  )

  it.skipIf(url === undefined)(
    'gives each channel exactly one unnamed channel group of its active managers in its room, and points the channel at it',
    async () => {
      const { groups, members, channels } = await groupsAndManagers(read)
      expect({ groups: inOrder(groups), members: inOrder(members), channels: inOrder(channels) }).toEqual({
        groups: inOrder([
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
          ...(hasStep(release, GROUPS)
            ? [{ id: TEAM, kind: 'team', name: 'Release', created_by: ID.ana, created_at: T0 + 30 * MINUTE }]
            : []),
        ]),
        members: inOrder([
          { group_id: 'grp_general00000', member_id: ID.ana },
          { group_id: 'grp_payroll00000', member_id: ID.ben },
          { group_id: 'grp_payroll00000', member_id: ID.cy },
          ...(hasStep(release, GROUPS)
            ? [
                { group_id: TEAM, member_id: ID.ana },
                { group_id: TEAM, member_id: ID.ben },
              ]
            : []),
        ]),
        channels: inOrder(
          ['general', 'lobby', 'payroll', 'retired'].map((slug) => ({
            slug,
            manager_group_id: `grp_${slug.padEnd(12, '0')}`,
          })),
        ),
      })
      const models = (hasStep(release, DEBATE_MODEL) ? ['model-c', null, null] : [null, null, null]).map(
        (model) => ({ agent_model: model }),
      )
      for (const [table, since] of [
        ['debate_turns', DEBATES],
        ['debate_drafts', RESULT_VOTES],
        ['debate_votes', RESULT_VOTES],
      ] as const)
        expect(inOrder(await read(`SELECT agent_model FROM ${table}`))).toEqual(
          hasStep(release, since) ? inOrder(models) : [],
        )
    },
    timeout,
  )

  it.skipIf(url === undefined)(
    'serves the groups to each viewer as far as rule 6 lets them see the channel',
    async () => {
      const shown = async (token: string) =>
        inOrder(
          (await as(token)('GET', '/groups')).json.groups.map((group: any) => [group.id, group.memberIds]),
        )
      const team = hasStep(release, GROUPS) ? [[TEAM, [ID.ana, ID.ben]]] : []
      expect(
        (await as(TOKEN.cyBrowser)('GET', '/groups')).json.groups.filter(
          (group: any) => group.kind === 'channel',
        ),
      ).toEqual([
        groupOf('grp_lobby0000000', [], 'lobby', T0, false),
        groupOf('grp_general00000', [ID.ana], 'general', T0 + MINUTE, false),
        groupOf('grp_payroll00000', [ID.ben, ID.cy], 'payroll', T0 + 2 * MINUTE, true),
      ])
      expect(await shown(TOKEN.cyBrowser)).toEqual(
        inOrder([
          ['grp_lobby0000000', []],
          ['grp_general00000', [ID.ana]],
          ['grp_payroll00000', [ID.ben, ID.cy]],
          ...team,
        ]),
      )
      expect(await shown(TOKEN.anaBrowser)).toEqual(
        inOrder([
          ['grp_lobby0000000', []],
          ['grp_general00000', [ID.ana]],
          ['grp_payroll00000', [ID.ben, ID.cy]],
          ['grp_retired00000', []],
          ...team,
        ]),
      )
      expect(await shown(TOKEN.anaAgent)).toEqual(
        inOrder([
          ['grp_lobby0000000', []],
          ['grp_general00000', [ID.ana]],
          ['grp_retired00000', []],
          ...team,
        ]),
      )
    },
    timeout,
  )

  it.skipIf(url === undefined)(
    'serves the members panel of each channel with the managers its group holds',
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
    timeout,
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
        inOrder(await read(`SELECT member_id FROM participants WHERE conversation_id = '${ROOM.retired}'`)),
      ).toEqual([{ member_id: ID.ana }, { member_id: ID.dee }])
    },
    timeout,
  )

  it.skipIf(url === undefined)(
    'lets the agents the release connected take turns in a new flock, and still shows a closed one',
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
      const closed = await as(TOKEN.cyBrowser)('GET', `/debates/${ID.debate}`)
      if (!hasStep(release, DEBATES)) return void expect(closed.status).toBe(404)
      expect(closed.json).toMatchObject({ status: 'closed', result: { draftedBy: ID.ben } })
      expect(closed.json.turns.map((turn: any) => [turn.agentName, turn.body, turn.agentModel])).toEqual([
        ['Ana agent', 'The March report says the rollback failed once.', null],
        ['Ben agent', 'It was fixed in the second week; I read the follow-up.', null],
        ['Cy agent', '두 번째 주가 좋습니다.', hasStep(release, DEBATE_MODEL) ? 'model-c' : null],
      ])
    },
    timeout,
  )

  it.skipIf(url === undefined)(
    'carries a note from draft to reply in a conversation the release made, with its sessions, agents and events',
    async () => {
      const ana = as(TOKEN.anaBrowser)
      const ben = as(TOKEN.benBrowser)
      const draft = (await ana('POST', '/drafts', { to: [ID.ben], body: 'Then March it is.' })).json
      expect(draft.conversationId).toBe(ID.direct)
      await server.clock.advance(1_000)
      const note = (await ana('POST', `/drafts/${draft.id}/send`, await asShown({ api: ana }, draft.id))).json
      expect((await as(TOKEN.benAgent)('POST', `/notes/${note.id}/pickup`)).status).toBe(200)
      const reply = (await as(TOKEN.benAgent)('POST', '/drafts', { inReplyTo: note.id, body: 'Agreed.' }))
        .json
      expect(
        (await ben('POST', `/drafts/${reply.id}/send`, await asShown({ api: ben }, reply.id))).status,
      ).toBe(200)
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
      expect(
        (await ana('POST', `/drafts/${ID.generalDraft}/send`, await asShown({ api: ana }, ID.generalDraft)))
          .json,
      ).toMatchObject({
        status: 'sent',
        body: 'Not ready to share.',
      })
      expect((await ben('GET', `/notes/${ID.generalDraft}`)).json).toMatchObject({ status: 'sent' })
    },
    timeout,
  )

  it.skipIf(url === undefined)(
    'lets a manager the release recorded make a channel agent whose answer waits for that manager and is sent as approved by them',
    async () => {
      const ana = as(TOKEN.anaBrowser)
      const cy = as(TOKEN.cyBrowser)
      expect((await ana('PUT', '/channels/general/agent', { name: 'General desk' })).status).toBe(200)
      const manager: Session = {
        cookie: `${SESSION_COOKIE}=${TOKEN.anaBrowser}`,
        token: TOKEN.anaBrowser,
        api: ana,
        me: null,
      }
      const agent = await issueAgentCredential(server, manager, 'general')
      const asked = (await cy('POST', '/drafts', { channel: 'general', body: 'Who runs payroll?' })).json
      const question = (await cy('POST', `/drafts/${asked.id}/send`, { expected: asRead(asked) })).json
      const answer = (await agent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Ana does.' })).json
      expect((await cy('GET', `/notes/${answer.id}`)).status).toBe(404)
      expect((await ana('GET', '/reviews')).json.reviews.map((review: any) => review.note.id)).toEqual([
        answer.id,
      ])
      expect((await as(TOKEN.benBrowser)('GET', '/reviews')).json.reviews).toEqual([])
      expect(
        (await agent.api('POST', `/drafts/${answer.id}/send`, { expected: asRead(answer) })).status,
      ).toBe(403)
      const sent = (await ana('POST', `/drafts/${answer.id}/send`, { expected: asRead(answer) })).json
      expect(sent).toMatchObject({ status: 'sent', approvedBy: ID.ana })
      expect((await cy('GET', `/notes/${answer.id}`)).json).toMatchObject({
        status: 'sent',
        body: 'Ana does.',
        approvedBy: ID.ana,
      })
      expect(inOrder(await read('SELECT DISTINCT kind FROM members'))).toEqual(
        inOrder([{ kind: 'channel_agent' }, { kind: 'person' }]),
      )
    },
    timeout,
  )

  it.skipIf(url === undefined)(
    'changes nothing but the record of the start on a second start',
    async () => {
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
    },
    timeout,
  )
})

describe.each(UPGRADES)(
  'A start on a database %s left that loses its connection during the upgrade, on %s',
  (_, dialect, release, url) => {
    const timeout = migrationTimeout(url)

    const pending = MIGRATIONS[release.steps]
    const first = pending?.find((step) => 'addTo' in step || 'primaryKey' in step)
    const cut = pending?.findLast((step) => 'addTo' in step)
    it.skipIf(url === undefined || cut === undefined || !('addTo' in cut))(
      'keeps the rows of the release as they were and the step unrecorded, its first change undone, or kept on MySQL, and the next start finishes the upgrade',
      async () => {
        if (cut === undefined || !('addTo' in cut)) return
        const database = await openTestDatabase(url?.startsWith('sqlite:') ? null : url)
        try {
          await databaseAt(release, database)
          const before = await rowsOfReleaseTables(release, database)
          const interrupted = await T.run(
            startDovecote({ kind: 'serve' }, PORT, () => {}),
            runtimeOn(
              losingConnectionAt(database, new RegExp(`^ALTER TABLE ${cut.addTo} ADD COLUMN ${cut.name} `)),
            ).env,
          )
          expect(interrupted).toMatchObject({ _tag: 'Err', error: { _tag: 'Die' } })
          const read = (query: string) => T.runPromise(database.all(raw(query)))
          expect(
            (await read('SELECT version FROM schema_versions'))
              .map((row) => Number(row.version))
              .sort(byNumber),
          ).toEqual(stepsThrough(release.steps))
          expect(await read(`SELECT ${cut.name} FROM ${cut.addTo}`).catch(() => 'no such column')).toBe(
            'no such column',
          )
          if (first !== undefined && first !== cut) {
            const probe =
              'addTo' in first
                ? `SELECT ${first.name} FROM ${first.addTo} WHERE 1 = 0`
                : 'primaryKey' in first
                  ? `SELECT * FROM ${first.name} WHERE 1 = 0`
                  : ''
            expect(
              await read(probe).then(
                () => 'kept',
                () => 'undone',
              ),
            ).toBe(dialect === 'MySQL' ? 'kept' : 'undone')
          }
          const { schema_versions: ___, ...kept } = await rowsOfReleaseTables(release, database)
          const { schema_versions: ____, ...keptBefore } = before
          expect(kept).toEqual(keptBefore)
          const finished = await startOn(database)
          expect(finished.outcome).toBe('serve')
          expect(
            (await read('SELECT version FROM schema_versions'))
              .map((row) => Number(row.version))
              .sort(byNumber),
          ).toEqual(stepsThrough(MIGRATIONS.length))
          expect(
            inOrder((await groupsAndManagers(read)).members).filter((row) => row.group_id !== TEAM),
          ).toEqual([
            { group_id: 'grp_general00000', member_id: ID.ana },
            { group_id: 'grp_payroll00000', member_id: ID.ben },
            { group_id: 'grp_payroll00000', member_id: ID.cy },
          ])
          expect(await T.runPromise(verifyAudit, finished.env)).toMatchObject({ ok: true })
        } finally {
          await T.runPromise(database.close)
        }
      },
      timeout,
    )
  },
)

interface Started {
  readonly outcome: { readonly exitCode: number } | 'serve'
  readonly env: ReturnType<typeof buildRuntime>['env']
}

const PORT = 8080
const STARTED_AT = 1_700_000_000_000

const stepsThrough = (last: number): number[] => Array.from({ length: last }, (_, index) => index + 1)

const byNumber = (left: number, right: number): number => left - right

const compareVersions = (earlier: string, later: string): number => {
  const [left, right] = [earlier, later].map((version) => version.split('.').map(Number)) as [
    number[],
    number[],
  ]
  for (const [index, part] of left.entries()) if (part !== right[index]) return part < right[index]! ? -1 : 1
  return 0
}

/** Rows in one order, whatever order and collation the database returned them in. */
const inOrder = <A>(rows: ReadonlyArray<A>): A[] =>
  [...rows].sort((left, right) => {
    const [a, b] = [JSON.stringify(left), JSON.stringify(right)]
    return a < b ? -1 : a > b ? 1 : 0
  })

const runtimeOn = (database: Database) =>
  buildRuntime({ config: testConfig(), database, clock: makeTestClock(STARTED_AT), write: () => {} })

/** What `dovecote` does when it starts on a database, before it listens. */
const startOn = async (database: Database): Promise<Started> => {
  const { env } = runtimeOn(database)
  return {
    outcome: await T.runPromise(
      startDovecote({ kind: 'serve' }, PORT, () => {}),
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
