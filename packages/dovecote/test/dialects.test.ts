import { Task as T } from '@homingbird/kernel'
import { featureSwitches } from '@homingbird/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordAudit, verifyAudit } from '../src/domain/audit.ts'
import { transact } from '../src/events/events.ts'
import type { Database } from '../src/sql/database.ts'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { DEBATE_MODEL } from '../src/sql/migrations/debate-model-step.ts'
import { GROUPS } from '../src/sql/migrations/groups-step.ts'
import { raw } from '../src/sql/query.ts'
import type { Migration } from '../src/sql/schema-steps.ts'
import { migrate, migrateThrough, schemaStatements } from '../src/sql/schema.ts'
import { TEST_DIALECTS, testDialects } from './dialect-support.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  asShown,
  connectAgent,
  openTestDatabase,
  startTestServer,
  storedRows,
} from './harness.ts'
import { CHANNELS_WITH_MANAGERS, GROUPS_FROM_MANAGERS, groupsAndManagers } from './migration-support.ts'

const stepsFrom = (first: number): number[] =>
  Array.from({ length: MIGRATIONS.length - first + 1 }, (_, index) => first + index)

const DIALECTS = TEST_DIALECTS

describe('The databases these tests run on', () => {
  it('are SQLite always, and PostgreSQL and MySQL when their URL is set', () => {
    expect(testDialects({})).toEqual([
      ['SQLite', 'sqlite::memory:'],
      ['PostgreSQL', undefined],
      ['MySQL', undefined],
    ])
    expect(testDialects({ HB_TEST_POSTGRES_URL: 'postgres://pg', HB_TEST_MYSQL_URL: 'mysql://my' })).toEqual([
      ['SQLite', 'sqlite::memory:'],
      ['PostgreSQL', 'postgres://pg'],
      ['MySQL', 'mysql://my'],
    ])
  })

  it('refuse to skip PostgreSQL or MySQL silently in the run HB_TEST_DATABASE_URL names it for', () => {
    expect(() => testDialects({ HB_TEST_DATABASE_URL: 'postgresql://pg' })).toThrow(
      'HB_TEST_DATABASE_URL names PostgreSQL, but HB_TEST_POSTGRES_URL is not set: set it to run the PostgreSQL variants.',
    )
    expect(() =>
      testDialects({ HB_TEST_DATABASE_URL: 'mysql://my', HB_TEST_POSTGRES_URL: 'postgres://pg' }),
    ).toThrow(/names MySQL, but HB_TEST_MYSQL_URL is not set/)
    expect(testDialects({ HB_TEST_DATABASE_URL: 'mysql://my', HB_TEST_MYSQL_URL: 'mysql://my' })[2]).toEqual([
      'MySQL',
      'mysql://my',
    ])
  })
})

describe.each(DIALECTS)('Dovecote on %s', (_, url) => {
  let server: TestServer
  let ana: Session
  let ben: Session
  let cy: Session
  let benAgent: Agent

  beforeAll(async () => {
    if (url === undefined) return
    server = await startTestServer({}, url.startsWith('sqlite:') ? {} : { databaseUrl: url })
    ana = await server.signIn('ana@example.com', 'Ana')
    ben = await server.signIn('ben@example.com', 'Ben')
    cy = await server.signIn('cy@example.com', 'Cy')
    benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
  })

  afterAll(() => server?.close())

  const send = async (author: Session, to: Session, body: string) => {
    const draft = (await author.api('POST', '/drafts', { to: [to.me.member.id], body })).json
    await server.clock.advance(1_000)
    return (await author.api('POST', `/drafts/${draft.id}/send`, await asShown(author, draft.id))).json
  }

  it.skipIf(url === undefined)('migrates twice without changing anything', async () => {
    await T.runPromise(migrate, server.env)
    const versions = await storedRows(server, 'schema_versions')
    expect(versions.map((row) => Number(row.version)).sort()).toEqual(versions.map((_, index) => index + 1))
  })

  it.skipIf(url === undefined)(
    'carries a note from draft to replied with numeric timestamps and counts',
    async () => {
      const note = await send(ana, ben, "Is the 100% migration safe? Ünïcödé 🕊 and a 'quote'")
      expect(typeof note.sentAt).toBe('number')
      expect((await ben.api('GET', `/conversations/${note.conversationId}`)).json.unreadCount).toBe(1)
      await benAgent.api('POST', `/notes/${note.id}/pickup`)
      await benAgent.api('POST', `/notes/${note.id}/pickup`)
      const reply = (await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: 'Yes.' })).json
      expect((await ben.api('GET', `/conversations/${note.conversationId}`)).json.draftCount).toBe(1)
      await ben.api(
        'POST',
        `/drafts/${reply.id}/send`,
        await asShown(ben, reply.id, { body: 'Yes, go ahead.' }),
      )
      const receipt = (await ana.api('GET', `/notes/${note.id}`)).json.receipts[0]
      expect(receipt.state).toBe('replied')
      expect(typeof receipt.repliedAt).toBe('number')
      const thread = (await ana.api('GET', `/conversations/${note.conversationId}/notes?limit=1`)).json
      expect(thread.notes.map((entry: any) => entry.body)).toEqual(['Yes, go ahead.'])
      expect(thread.hasMore).toBe(true)
      expect(thread.notes[0].origin).toBe('human_edited')
    },
  )

  it.skipIf(url === undefined)('searches without case and treats wildcards literally', async () => {
    expect((await ana.api('GET', '/search?q=MIGRATION')).json.notes).toHaveLength(1)
    expect((await ana.api('GET', '/search?q=100%25')).json.notes).toHaveLength(1)
    expect((await ana.api('GET', '/search?q=1_0')).json.notes).toEqual([])
    expect(
      (await ana.api('GET', `/search?q=${encodeURIComponent('ünïcödé')}`)).json.notes.length,
    ).toBeLessThanOrEqual(1)
    expect((await cy.api('GET', '/search?q=migration')).json.notes).toEqual([])
  })

  it.skipIf(url === undefined)('keeps one direct conversation when both sides start it at once', async () => {
    const drafts = await Promise.all([
      ana.api('POST', '/drafts', { to: [cy.me.member.id], body: 'a' }),
      cy.api('POST', '/drafts', { to: [ana.me.member.id], body: 'c' }),
      ana.api('POST', '/drafts', { to: [cy.me.member.id], body: 'a2' }),
      cy.api('POST', '/drafts', { to: [ana.me.member.id], body: 'c2' }),
    ])
    expect(drafts.map((draft) => draft.status)).toEqual([200, 200, 200, 200])
    expect(new Set(drafts.map((draft) => draft.json.conversationId)).size).toBe(1)
  })

  it.skipIf(url === undefined)('sends a draft once when two approvals race', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'once' })).json
    const outcomes = await Promise.all([
      ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id)),
      ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id)),
    ])
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([200, 409])
    const receipts = (await storedRows(server, 'receipts')).filter((row) => row.note_id === draft.id)
    expect(receipts).toHaveLength(1)
  })

  it.skipIf(url === undefined)('numbers events per member and resumes after a cursor', async () => {
    const all = (await ben.api('GET', '/events/poll?after=0')).json
    expect(all.events.map((event: any) => event.seq)).toEqual(
      all.events.map((_: unknown, index: number) => index + 1),
    )
    expect(all.cursor).toBe(all.events.length)
    const rest = (await ben.api('GET', `/events/poll?after=${all.cursor - 1}`)).json
    expect(rest.events.map((event: any) => event.seq)).toEqual([all.cursor])
  })

  it.skipIf(url === undefined)('handles contacts, repeated blocks and unblocking', async () => {
    await ana.api('POST', '/contacts', { memberId: ben.me.member.id })
    await ana.api('POST', '/contacts', { memberId: ben.me.member.id })
    expect((await ben.api('POST', `/contacts/${ana.me.member.id}/accept`)).json.state).toBe('accepted')
    await cy.api('PUT', `/blocks/${ana.me.member.id}`)
    await cy.api('PUT', `/blocks/${ana.me.member.id}`)
    expect((await cy.api('GET', '/contacts')).json.blocked).toEqual([ana.me.member.id])
    expect((await ana.api('POST', '/drafts', { to: [cy.me.member.id], body: 'blocked' })).status).toBe(403)
    await cy.api('DELETE', `/blocks/${ana.me.member.id}`)
    expect((await ana.api('POST', '/drafts', { to: [cy.me.member.id], body: 'unblocked' })).status).toBe(200)
  })

  it.skipIf(url === undefined)(
    'chains the audit trail under its serial ids, verifies it, and rolls back a refused action',
    async () => {
      const ids = (await storedRows(server, 'audit_events')).map((row) => Number(row.id))
      expect(ids.length).toBeGreaterThan(2)
      expect([...ids].sort((a, b) => a - b)).toEqual(ids)
      expect(await T.runPromise(verifyAudit, server.env)).toMatchObject({ ok: true, rows: ids.length })
      expect((await ana.api('PATCH', `/admin/members/${ana.me.member.id}`, { role: 'member' })).status).toBe(
        409,
      )
      expect((await storedRows(server, 'audit_events')).length).toBe(ids.length)
    },
  )

  it.skipIf(url === undefined)(
    'keeps one unbroken chain when many requests write audit rows at once',
    async () => {
      const before = (await storedRows(server, 'audit_events')).length
      await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          T.runPromise(
            transact(recordAudit('system.migrated', { detail: { steps: [index + 1] } })),
            server.env,
          ),
        ),
      )
      expect((await storedRows(server, 'audit_events')).length).toBe(before + 12)
      expect(await T.runPromise(verifyAudit, server.env)).toMatchObject({ ok: true, rows: before + 12 })
    },
  )

  it.skipIf(url === undefined)(
    'stores settings, revokes credentials on deactivation and expires sessions',
    async () => {
      const settings = { allowedDomains: ['example.com'], contactMode: 'open' }
      expect((await ana.api('PUT', '/admin/settings', settings)).json).toEqual({
        ...settings,
        answeringFlow: null,
        features: featureSwitches({}),
      })
      expect((await ana.api('PUT', '/admin/settings', settings)).json).toEqual({
        ...settings,
        answeringFlow: null,
        features: featureSwitches({}),
      })
      await ana.api('PATCH', `/admin/members/${cy.me.member.id}`, { status: 'deactivated' })
      expect((await cy.api('GET', '/me')).status).toBe(401)
      await server.clock.advance(31 * 24 * 60 * 60_000)
      expect((await ana.api('GET', '/me')).status).toBe(401)
      expect((await benAgent.api('GET', '/me')).status).toBe(200)
    },
  )
})

describe.each(DIALECTS)('The schema on %s', (_, url) => {
  const emptyDatabase = () => openTestDatabase(url?.startsWith('sqlite:') ? null : url)
  const migrated = (database: Database, migrations?: ReadonlyArray<Migration>) =>
    T.runPromise(T.result(migrations === undefined ? migrate : migrateThrough(migrations)), {
      database,
      connection: database,
    })
  const versionsOf = async (database: Database) =>
    (await T.runPromise(database.all(raw('SELECT version FROM schema_versions'))))
      .map((row) => Number(row.version))
      .sort((a, b) => a - b)
  const REFUSAL = {
    _tag: 'Err',
    error: {
      _tag: 'UnknownDatabase',
      message:
        'This database was not made by this version of Dovecote, so it is left untouched: start Dovecote with an empty database.',
    },
  }

  it.skipIf(url === undefined)('creates every step on an empty database, once', async () => {
    const database = await emptyDatabase()
    try {
      expect(await migrated(database)).toEqual({ _tag: 'Ok', value: stepsFrom(1) })
      expect(await migrated(database)).toEqual({ _tag: 'Ok', value: [] })
      expect(await versionsOf(database)).toEqual(stepsFrom(1))
      expect(await T.runPromise(database.all(raw('SELECT archived_at FROM conversations')))).toEqual([])
    } finally {
      await T.runPromise(database.close)
    }
  })

  it.skipIf(url === undefined)(
    'adds the debate room tables as step 3 to a database that has steps 1 and 2, keeping its rows',
    async () => {
      const database = await emptyDatabase()
      try {
        expect(await migrated(database, MIGRATIONS.slice(0, 2))).toEqual({ _tag: 'Ok', value: [1, 2] })
        await T.runPromise(database.run(raw(MEMBER_ROW)))
        expect(
          await T.runPromise(database.all(raw('SELECT id FROM debates'))).catch(() => 'no debates table'),
        ).toBe('no debates table')
        expect(await migrated(database)).toEqual({ _tag: 'Ok', value: stepsFrom(3) })
        expect(await versionsOf(database)).toEqual(stepsFrom(1))
        for (const table of [
          'debates',
          'debate_members',
          'debate_participants',
          'debate_turns',
          'debate_approvals',
          'debate_credits',
        ])
          expect(await T.runPromise(database.all(raw(`SELECT * FROM ${table}`)))).toEqual([])
        expect(
          (await T.runPromise(database.all(raw('SELECT id FROM members')))).map((row) => row.id),
        ).toEqual(['mem_kept'])
      } finally {
        await T.runPromise(database.close)
      }
    },
  )

  it.skipIf(url === undefined)(
    'adds the audit trail as step 5 to a database that has steps 1 to 4, keeping its rows and the first audit table',
    async () => {
      const database = await emptyDatabase()
      try {
        expect(await migrated(database, MIGRATIONS.slice(0, 4))).toEqual({ _tag: 'Ok', value: [1, 2, 3, 4] })
        await T.runPromise(database.run(raw(MEMBER_ROW)))
        expect(await migrated(database)).toEqual({ _tag: 'Ok', value: stepsFrom(5) })
        for (const table of ['audit_events', 'audit_head', 'audit_log'])
          expect(await T.runPromise(database.all(raw(`SELECT * FROM ${table}`)))).toEqual([])
        expect(
          (await T.runPromise(database.all(raw('SELECT id FROM members')))).map((row) => row.id),
        ).toEqual(['mem_kept'])
      } finally {
        await T.runPromise(database.close)
      }
    },
  )

  it.skipIf(url === undefined)(
    'adds groups as step 6, making each channel an unnamed channel group of its active managers in its room, and runs its backfills twice without a change',
    async () => {
      const database = await emptyDatabase()
      try {
        expect(await migrated(database, MIGRATIONS.slice(0, 5))).toEqual({
          _tag: 'Ok',
          value: [1, 2, 3, 4, 5],
        })
        for (const statement of CHANNELS_WITH_MANAGERS) await T.runPromise(database.run(raw(statement)))
        expect(await migrated(database)).toEqual({ _tag: 'Ok', value: stepsFrom(6) })
        const read = (query: string) => T.runPromise(database.all(raw(query)))
        expect(await groupsAndManagers(read)).toEqual(GROUPS_FROM_MANAGERS)
        for (const step of GROUPS)
          if ('backfill' in step) await T.runPromise(database.run(raw(step.backfill)))
        expect(await groupsAndManagers(read)).toEqual(GROUPS_FROM_MANAGERS)
      } finally {
        await T.runPromise(database.close)
      }
    },
  )

  it.skipIf(url === undefined || !url.startsWith('mysql'))(
    'finishes step 6 after MySQL left it half applied, with each group made once',
    async () => {
      const database = await emptyDatabase()
      try {
        await migrated(database, MIGRATIONS.slice(0, 5))
        for (const statement of CHANNELS_WITH_MANAGERS) await T.runPromise(database.run(raw(statement)))
        const half = schemaStatements('mysql', [[], GROUPS]).slice(1, 6)
        expect(half.at(-1)).toMatch(/^INSERT INTO member_groups/)
        for (const statement of half) await T.runPromise(database.run(raw(statement)))
        expect(await migrated(database)).toEqual({ _tag: 'Ok', value: stepsFrom(6) })
        expect(await groupsAndManagers((query) => T.runPromise(database.all(raw(query))))).toEqual(
          GROUPS_FROM_MANAGERS,
        )
      } finally {
        await T.runPromise(database.close)
      }
    },
  )

  it.skipIf(url === undefined)(
    'adds the agent model as step 7 to the turns, result drafts and votes of a database that has steps 1 to 6, keeping their rows',
    async () => {
      const database = await emptyDatabase()
      try {
        expect(await migrated(database, MIGRATIONS.slice(0, 6))).toEqual({
          _tag: 'Ok',
          value: [1, 2, 3, 4, 5, 6],
        })
        for (const statement of [DEBATE_ROW, TURN_ROW, RESULT_DRAFT_ROW, VOTE_ROW])
          await T.runPromise(database.run(raw(statement)))
        expect(
          await T.runPromise(database.all(raw('SELECT agent_model FROM debate_turns'))).catch(
            () => 'no agent model',
          ),
        ).toBe('no agent model')
        expect(await migrated(database)).toEqual({ _tag: 'Ok', value: stepsFrom(7) })
        expect(await versionsOf(database)).toEqual(stepsFrom(1))
        expect(await agentModels(database)).toEqual(KEPT_AGENT_MODELS)
      } finally {
        await T.runPromise(database.close)
      }
    },
  )

  it.skipIf(url === undefined || !url.startsWith('mysql'))(
    'finishes step 7 after MySQL left it half applied, skipping the column already added',
    async () => {
      const database = await emptyDatabase()
      try {
        await migrated(database, MIGRATIONS.slice(0, 6))
        for (const statement of [DEBATE_ROW, TURN_ROW, RESULT_DRAFT_ROW, VOTE_ROW])
          await T.runPromise(database.run(raw(statement)))
        const half = schemaStatements('mysql', [[], DEBATE_MODEL]).slice(1, 2)
        expect(half).toEqual(['ALTER TABLE debate_turns ADD COLUMN agent_model VARCHAR(400)'])
        for (const statement of half) await T.runPromise(database.run(raw(statement)))
        expect(await migrated(database)).toEqual({ _tag: 'Ok', value: stepsFrom(7) })
        expect(await versionsOf(database)).toEqual(stepsFrom(1))
        expect(await agentModels(database)).toEqual(KEPT_AGENT_MODELS)
      } finally {
        await T.runPromise(database.close)
      }
    },
  )

  it.skipIf(url === undefined)(
    'adds the result votes as step 4 to a database that has steps 1 to 3, keeping its rooms',
    async () => {
      const database = await emptyDatabase()
      try {
        expect(await migrated(database, MIGRATIONS.slice(0, 3))).toEqual({ _tag: 'Ok', value: [1, 2, 3] })
        await T.runPromise(database.run(raw(DEBATE_ROW)))
        expect(
          await T.runPromise(database.all(raw('SELECT * FROM debate_votes'))).catch(() => 'no votes table'),
        ).toBe('no votes table')
        expect(await migrated(database)).toEqual({ _tag: 'Ok', value: stepsFrom(4) })
        expect(await versionsOf(database)).toEqual(stepsFrom(1))
        expect(await T.runPromise(database.all(raw('SELECT id, votes_open_at FROM debates')))).toEqual([
          { id: 'deb_kept', votes_open_at: null },
        ])
        for (const table of ['debate_drafts', 'debate_votes'])
          expect(await T.runPromise(database.all(raw(`SELECT * FROM ${table}`)))).toEqual([])
      } finally {
        await T.runPromise(database.close)
      }
    },
  )

  it.skipIf(url === undefined || !url.startsWith('mysql'))(
    'runs step 4 again after MySQL left it half applied, skipping the column already added',
    async () => {
      const database = await emptyDatabase()
      try {
        await migrated(database, MIGRATIONS.slice(0, 3))
        const fourth = MIGRATIONS[3] ?? []
        const half = schemaStatements('mysql', [[], fourth]).slice(1, 3)
        expect(half[0]).toMatch(/^ALTER TABLE debates ADD COLUMN votes_open_at/)
        for (const statement of half) await T.runPromise(database.run(raw(statement)))
        expect(await migrated(database)).toEqual({ _tag: 'Ok', value: stepsFrom(4) })
        expect(await versionsOf(database)).toEqual(stepsFrom(1))
        expect(await T.runPromise(database.all(raw('SELECT * FROM debate_votes')))).toEqual([])
      } finally {
        await T.runPromise(database.close)
      }
    },
  )

  it.skipIf(url === undefined)(
    'refuses a database that records versions this build does not know, and changes nothing in it',
    async () => {
      const database = await emptyDatabase()
      try {
        await migrated(database)
        const unknown = [1, 2, 3].map((later) => MIGRATIONS.length + later)
        for (const version of unknown)
          await T.runPromise(database.run(raw(`INSERT INTO schema_versions (version) VALUES (${version})`)))
        await T.runPromise(database.run(raw(MEMBER_ROW)))
        expect(await migrated(database)).toEqual(REFUSAL)
        expect(await versionsOf(database)).toEqual([...stepsFrom(1), ...unknown])
        expect(
          (await T.runPromise(database.all(raw('SELECT id FROM members')))).map((row) => row.id),
        ).toEqual(['mem_kept'])
      } finally {
        await T.runPromise(database.close)
      }
    },
  )

  it.skipIf(url === undefined)(
    'upgrades a 0.1.0 database to step 2, keeping its notes and adding the new columns and tables',
    async () => {
      const database = await emptyDatabase()
      try {
        const [baseline = []] = MIGRATIONS
        await migrated(database, [baseline])
        expect(await versionsOf(database)).toEqual([1])
        await T.runPromise(database.run(raw(MEMBER_ROW)))
        await T.runPromise(database.run(raw(CONVERSATION_ROW)))
        await T.runPromise(database.run(raw(NOTE_ROW)))
        expect(await migrated(database)).toEqual({ _tag: 'Ok', value: stepsFrom(2) })
        expect(await versionsOf(database)).toEqual(stepsFrom(1))
        expect(
          await T.runPromise(
            database.all(
              raw('SELECT id, body, seen_at, decided_at, agent_body, agent_client, agent_model FROM notes'),
            ),
          ),
        ).toEqual([
          {
            id: 'note_kept',
            body: 'Kept from 0.1.0',
            seen_at: null,
            decided_at: null,
            agent_body: null,
            agent_client: null,
            agent_model: null,
          },
        ])
        for (const table of [
          'principles',
          'principle_applications',
          'principle_offers',
          'principle_quiet_places',
          'releases',
        ])
          expect(await T.runPromise(database.all(raw(`SELECT * FROM ${table}`)))).toEqual([])
      } finally {
        await T.runPromise(database.close)
      }
    },
  )

  it.skipIf(url === undefined || !url.startsWith('mysql'))(
    'finishes a step that MySQL left half applied, skipping the columns and indexes already there',
    async () => {
      const database = await emptyDatabase()
      try {
        const [baseline = [], second = []] = MIGRATIONS
        await migrated(database, [baseline])
        const half = schemaStatements('mysql', [[], second]).slice(1, 9)
        expect(half.some((statement) => statement.startsWith('CREATE INDEX'))).toBe(true)
        for (const statement of half) await T.runPromise(database.run(raw(statement)))
        expect(await migrated(database)).toEqual({ _tag: 'Ok', value: stepsFrom(2) })
        expect(await versionsOf(database)).toEqual(stepsFrom(1))
        expect(
          await T.runPromise(database.all(raw('SELECT agent_body, session_minutes FROM notes'))),
        ).toEqual([])
      } finally {
        await T.runPromise(database.close)
      }
    },
  )

  it.skipIf(url === undefined)(
    'refuses tables that no recorded version made, and changes nothing in them',
    async () => {
      const database = await emptyDatabase()
      try {
        await T.runPromise(
          database.run(raw('CREATE TABLE members (id VARCHAR(64) NOT NULL, PRIMARY KEY (id))')),
        )
        await T.runPromise(database.run(raw("INSERT INTO members (id) VALUES ('mem_kept')")))
        expect(await migrated(database)).toEqual(REFUSAL)
        expect(await versionsOf(database)).toEqual([])
        expect(await T.runPromise(database.all(raw('SELECT * FROM members')))).toEqual([{ id: 'mem_kept' }])
        expect(
          await T.runPromise(database.all(raw('SELECT * FROM notes'))).catch(() => 'no notes table'),
        ).toBe('no notes table')
      } finally {
        await T.runPromise(database.close)
      }
    },
  )

  it.skipIf(url === undefined)(
    'applies a later step once, adding a nullable column and filling it, and keeps the rows',
    async () => {
      const database = await emptyDatabase()
      try {
        await T.runPromise(database.run(raw('DROP TABLE IF EXISTS scratch_notes')))
        const first: Migration = [
          { name: 'scratch_notes', columns: { id: { type: 'id' } }, primaryKey: ['id'] },
        ]
        const second: Migration = [
          { addTo: 'scratch_notes', name: 'mood', column: { type: 'string', nullable: true } },
          { backfill: "UPDATE scratch_notes SET mood = 'calm'" },
        ]
        await migrated(database, [first])
        await T.runPromise(database.run(raw("INSERT INTO scratch_notes (id) VALUES ('n1')")))
        await migrated(database, [first, second])
        await migrated(database, [first, second])
        expect(await T.runPromise(database.all(raw('SELECT id, mood FROM scratch_notes')))).toEqual([
          { id: 'n1', mood: 'calm' },
        ])
        expect(await versionsOf(database)).toEqual([1, 2])
        await T.runPromise(database.run(raw('DROP TABLE scratch_notes')))
      } finally {
        await T.runPromise(database.close)
      }
    },
  )
})

const MEMBER_ROW =
  "INSERT INTO members (id, email, subject, name, profile, role, status, event_seq, created_at) VALUES ('mem_kept', 'kept@example.com', 'dev:kept', 'Kept', '', 'member', 'active', 0, 1)"
const DEBATE_ROW =
  "INSERT INTO debates (id, question, visibility, status, created_by, turns_per_agent, total_turns, minutes, turn_characters, created_at, updated_at, deadline_at, result_round) VALUES ('deb_kept', 'Kept?', 'open', 'open', 'mem_kept', 1, 2, 5, 200, 1, 1, 2, 0)"
const TURN_ROW =
  "INSERT INTO debate_turns (debate_id, position, member_id, credential_id, agent_name, body, created_at) VALUES ('deb_kept', 1, 'mem_kept', 'cred_kept', 'Kept agent', 'A kept turn', 1)"
const RESULT_DRAFT_ROW =
  "INSERT INTO debate_drafts (debate_id, round, member_id, credential_id, result, created_at) VALUES ('deb_kept', 1, 'mem_kept', 'cred_kept', 'A kept result', 1)"
const VOTE_ROW =
  "INSERT INTO debate_votes (debate_id, round, voter_id, draft_by, created_at) VALUES ('deb_kept', 1, 'mem_kept', 'mem_kept', 1)"
const KEPT_AGENT_MODELS = {
  turns: [{ body: 'A kept turn', agent_model: null }],
  drafts: [{ result: 'A kept result', agent_model: null }],
  votes: [{ draft_by: 'mem_kept', agent_model: null }],
}
const agentModels = async (database: Database) => {
  const read = (query: string) => T.runPromise(database.all(raw(query)))
  return {
    turns: await read('SELECT body, agent_model FROM debate_turns'),
    drafts: await read('SELECT result, agent_model FROM debate_drafts'),
    votes: await read('SELECT draft_by, agent_model FROM debate_votes'),
  }
}
const CONVERSATION_ROW =
  "INSERT INTO conversations (id, kind, created_at, last_activity_at) VALUES ('conv_kept', 'direct', 1, 1)"
const NOTE_ROW =
  "INSERT INTO notes (id, conversation_id, author_id, status, body, origin, created_at, updated_at, sent_at) VALUES ('note_kept', 'conv_kept', 'mem_kept', 'sent', 'Kept from 0.1.0', 'human', 1, 1, 1)"
