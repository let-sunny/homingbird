import { Task as T } from '@homingbird/kernel'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '../src/sql/database.ts'
import { raw } from '../src/sql/query.ts'
import { type Migration, migrate, migrateThrough } from '../src/sql/schema.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  connectAgent,
  openTestDatabase,
  startTestServer,
  storedRows,
} from './harness.ts'

const DIALECTS = [
  ['SQLite', 'sqlite::memory:'],
  ['PostgreSQL', process.env.HB_TEST_POSTGRES_URL],
  ['MySQL', process.env.HB_TEST_MYSQL_URL],
] as const

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
    return (await author.api('POST', `/drafts/${draft.id}/send`, {})).json
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
      await ben.api('POST', `/drafts/${reply.id}/send`, { body: 'Yes, go ahead.' })
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
      ana.api('POST', `/drafts/${draft.id}/send`, {}),
      ana.api('POST', `/drafts/${draft.id}/send`, {}),
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
    'pages the audit log by its serial id and rolls back a refused action',
    async () => {
      const first = (await ana.api('GET', '/admin/audit?limit=2')).json
      expect(first.entries).toHaveLength(2)
      expect(typeof first.entries[0].id).toBe('number')
      expect(first.entries[0].id).toBeGreaterThan(first.entries[1].id)
      const next = (await ana.api('GET', `/admin/audit?limit=2&before=${first.entries[1].id}`)).json
      expect(next.entries[0].id).toBeLessThan(first.entries[1].id)
      const before = (await storedRows(server, 'audit_log')).length
      expect((await ana.api('PATCH', `/admin/members/${ana.me.member.id}`, { role: 'member' })).status).toBe(
        409,
      )
      expect((await storedRows(server, 'audit_log')).length).toBe(before)
    },
  )

  it.skipIf(url === undefined)(
    'stores settings, revokes credentials on deactivation and expires sessions',
    async () => {
      const settings = { allowedDomains: ['example.com'], contactMode: 'open', auditRetentionDays: 30 }
      expect((await ana.api('PUT', '/admin/settings', settings)).json).toEqual({
        ...settings,
        answeringFlow: null,
      })
      expect((await ana.api('PUT', '/admin/settings', settings)).json).toEqual({
        ...settings,
        answeringFlow: null,
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
    (await database.all(raw('SELECT version FROM schema_versions'))).map((row) => Number(row.version)).sort()
  const REFUSAL = {
    _tag: 'Err',
    error: {
      _tag: 'UnknownDatabase',
      message:
        'This database was not made by this version of Dovecote, so it is left untouched: start Dovecote with an empty database.',
    },
  }

  it.skipIf(url === undefined)(
    'creates the 0.1.0 schema on an empty database as version 1, once',
    async () => {
      const database = await emptyDatabase()
      try {
        expect(await migrated(database)).toEqual({ _tag: 'Ok', value: undefined })
        expect(await migrated(database)).toEqual({ _tag: 'Ok', value: undefined })
        expect(await versionsOf(database)).toEqual([1])
        expect(await database.all(raw('SELECT archived_at FROM conversations'))).toEqual([])
      } finally {
        await database.close()
      }
    },
  )

  it.skipIf(url === undefined)(
    'refuses a database that records versions this build does not know, and changes nothing in it',
    async () => {
      const database = await emptyDatabase()
      try {
        await migrated(database)
        for (const version of [2, 3, 4, 5, 6, 7, 8])
          await database.run(raw(`INSERT INTO schema_versions (version) VALUES (${version})`))
        await database.run(raw(MEMBER_ROW))
        expect(await migrated(database)).toEqual(REFUSAL)
        expect(await versionsOf(database)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
        expect((await database.all(raw('SELECT id FROM members'))).map((row) => row.id)).toEqual(['mem_kept'])
      } finally {
        await database.close()
      }
    },
  )

  it.skipIf(url === undefined)(
    'refuses tables that no recorded version made, and changes nothing in them',
    async () => {
      const database = await emptyDatabase()
      try {
        await database.run(raw('CREATE TABLE members (id VARCHAR(64) NOT NULL, PRIMARY KEY (id))'))
        await database.run(raw("INSERT INTO members (id) VALUES ('mem_kept')"))
        expect(await migrated(database)).toEqual(REFUSAL)
        expect(await versionsOf(database)).toEqual([])
        expect(await database.all(raw('SELECT * FROM members'))).toEqual([{ id: 'mem_kept' }])
        expect(await database.all(raw('SELECT * FROM notes')).catch(() => 'no notes table')).toBe(
          'no notes table',
        )
      } finally {
        await database.close()
      }
    },
  )

  it.skipIf(url === undefined)(
    'applies a later step once, adding a nullable column and filling it, and keeps the rows',
    async () => {
      const database = await emptyDatabase()
      try {
        await database.run(raw('DROP TABLE IF EXISTS scratch_notes'))
        const first: Migration = [
          { name: 'scratch_notes', columns: { id: { type: 'id' } }, primaryKey: ['id'] },
        ]
        const second: Migration = [
          { addTo: 'scratch_notes', name: 'mood', column: { type: 'string', nullable: true } },
          { backfill: "UPDATE scratch_notes SET mood = 'calm'" },
        ]
        await migrated(database, [first])
        await database.run(raw("INSERT INTO scratch_notes (id) VALUES ('n1')"))
        await migrated(database, [first, second])
        await migrated(database, [first, second])
        expect(await database.all(raw('SELECT id, mood FROM scratch_notes'))).toEqual([
          { id: 'n1', mood: 'calm' },
        ])
        expect(await versionsOf(database)).toEqual([1, 2])
        await database.run(raw('DROP TABLE scratch_notes'))
      } finally {
        await database.close()
      }
    },
  )
})

const MEMBER_ROW =
  "INSERT INTO members (id, email, subject, name, profile, role, status, event_seq, created_at) VALUES ('mem_kept', 'kept@example.com', 'dev:kept', 'Kept', '', 'member', 'active', 0, 1)"
