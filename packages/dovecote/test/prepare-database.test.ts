import { Task as T, makeTestClock } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareDatabase } from '../src/prepare-database.ts'
import { buildRuntime } from '../src/runtime.ts'
import { type Database, all, run } from '../src/sql/database.ts'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { insertInto, sql } from '../src/sql/query.ts'
import { migrateThrough } from '../src/sql/schema.ts'
import { openTestDatabase, testConfig } from './harness.ts'

let database: Database | null = null

afterEach(async () => {
  await (database && T.runPromise(database.close))
  database = null
})

const preparedRuntime = async (channels?: string) => {
  database = await openTestDatabase()
  const { env } = buildRuntime({
    config: testConfig(channels === undefined ? {} : { HB_CHANNELS: channels }),
    database,
    clock: makeTestClock(1_700_000_000_000),
    write: () => {},
  })
  await T.runPromise(prepareDatabase, env)
  return env
}

const slugs = (env: Awaited<ReturnType<typeof preparedRuntime>>) =>
  T.runPromise(all<{ slug: string }>(sql`SELECT slug FROM channels ORDER BY slug`), env).then((rows) =>
    rows.map((row) => row.slug),
  )

describe('preparing the database', () => {
  it('creates the tables and no channel of its own, so an embedded server needs nothing else', async () => {
    expect(await slugs(await preparedRuntime())).toEqual([])
  })

  it('seeds exactly the configured channels and can run again on every start', async () => {
    const env = await preparedRuntime('billing: Invoices, general')
    await T.runPromise(prepareDatabase, env)
    expect(await slugs(env)).toEqual(['billing', 'general'])
  })

  it('joins nobody to a seeded channel and keeps an existing general channel with its members', async () => {
    const env = await preparedRuntime('general')
    await T.runPromise(
      T.gen(function* () {
        yield* run(sql`INSERT INTO members (id, email, subject, name, profile, role, status, event_seq, created_at)
          VALUES ('mem_ana', 'ana@example.com', 'dev:ana', 'Ana', '', 'member', 'active', 0, 1)`)
        const [general] = yield* all<{ conversation_id: string }>(
          sql`SELECT conversation_id FROM channels WHERE slug = 'general'`,
        )
        yield* run(
          sql`INSERT INTO participants (conversation_id, member_id) VALUES (${general?.conversation_id}, 'mem_ana')`,
        )
      }),
      env,
    )
    const restarted = { ...env, config: testConfig({ HB_CHANNELS: 'billing' }) }
    await T.runPromise(prepareDatabase, restarted)
    expect(await slugs(restarted)).toEqual(['billing', 'general'])
    const members = await T.runPromise(
      all<{ slug: string; member_id: string }>(
        sql`SELECT t.slug, p.member_id FROM channels t JOIN participants p ON p.conversation_id = t.conversation_id`,
      ),
      restarted,
    )
    expect(members).toEqual([{ slug: 'general', member_id: 'mem_ana' }])
  })

  it('records the schema steps it applied in the audit trail, and none on a start with nothing to do', async () => {
    const env = await preparedRuntime()
    await T.runPromise(prepareDatabase, env)
    const rows = await T.runPromise(
      all<{ event: string; detail: string }>(sql`SELECT event, detail FROM audit_events`),
      env,
    )
    expect(rows.map((row) => [row.event, JSON.parse(row.detail)])).toEqual([
      ['system.migrated', { steps: [1, 2, 3, 4, 5, 6, 7] }],
    ])
  })

  it('refuses to start on a database an earlier build made, seeding nothing', async () => {
    const env = await preparedRuntime()
    await T.runPromise(run(sql`INSERT INTO schema_versions (version) VALUES (8)`), env)
    const restarted = { ...env, config: testConfig({ HB_CHANNELS: 'billing' }) }
    expect(await T.runPromise(T.result(prepareDatabase), restarted)).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'UnknownDatabase' },
    })
    expect(await slugs(restarted)).toEqual([])
  })

  it('ages out the first audit table at the upgrade, by the retention the organization had saved', async () => {
    database = await openTestDatabase()
    const { env } = buildRuntime({
      config: testConfig(),
      database,
      clock: makeTestClock(1_700_000_000_000),
      write: () => {},
    })
    await T.runPromise(migrateThrough(MIGRATIONS.slice(0, 4)), env)
    const DAY = 24 * 60 * 60_000
    const legacy = (createdAt: number) =>
      insertInto('audit_log', {
        created_at: createdAt,
        actor_id: null,
        credential_id: null,
        credential_kind: null,
        action: 'drafts.send',
        target: null,
        detail: '{"note":{"body":"old words"}}',
      })
    await T.runPromise(
      T.gen(function* () {
        yield* run(legacy(1_700_000_000_000 - 31 * DAY))
        yield* run(legacy(1_700_000_000_000 - 29 * DAY))
        yield* run(
          insertInto('settings', {
            name: 'organization',
            value: JSON.stringify({ allowedDomains: [], contactMode: 'open', auditRetentionDays: 30 }),
          }),
        )
      }),
      env,
    )
    await T.runPromise(prepareDatabase, env)
    expect((await T.runPromise(all(sql`SELECT created_at FROM audit_log`), env)).length).toBe(1)
    const rows = await T.runPromise(
      all<{ event: string; detail: string }>(sql`SELECT event, detail FROM audit_events`),
      env,
    )
    expect(rows.map((row) => [row.event, JSON.parse(row.detail)])).toEqual([
      ['system.migrated', { steps: [5, 6, 7] }],
      ['audit.legacy_purged', { removed: 1, because: 'upgrade' }],
    ])
  })

  it('keeps the whole first audit table at the upgrade when the organization had saved keep forever', async () => {
    database = await openTestDatabase()
    const { env } = buildRuntime({
      config: testConfig(),
      database,
      clock: makeTestClock(1_700_000_000_000),
      write: () => {},
    })
    await T.runPromise(migrateThrough(MIGRATIONS.slice(0, 4)), env)
    const DAY = 24 * 60 * 60_000
    const legacy = (createdAt: number) =>
      insertInto('audit_log', {
        created_at: createdAt,
        actor_id: null,
        credential_id: null,
        credential_kind: null,
        action: 'drafts.send',
        target: null,
        detail: '{"note":{"body":"old words"}}',
      })
    await T.runPromise(
      T.gen(function* () {
        yield* run(legacy(1_700_000_000_000 - 31 * DAY))
        yield* run(legacy(1_700_000_000_000 - 29 * DAY))
        yield* run(
          insertInto('settings', {
            name: 'organization',
            value: JSON.stringify({ allowedDomains: [], contactMode: 'open', auditRetentionDays: null }),
          }),
        )
      }),
      env,
    )
    await T.runPromise(prepareDatabase, env)
    expect((await T.runPromise(all(sql`SELECT created_at FROM audit_log`), env)).length).toBe(2)
    const rows = await T.runPromise(
      all<{ event: string; detail: string }>(sql`SELECT event, detail FROM audit_events`),
      env,
    )
    expect(rows.map((row) => [row.event, JSON.parse(row.detail)])).toEqual([
      ['system.migrated', { steps: [5, 6, 7] }],
    ])
  })
})
