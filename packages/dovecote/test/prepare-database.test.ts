import { Task as T, makeTestClock } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareDatabase } from '../src/prepare-database.ts'
import { buildRuntime } from '../src/runtime.ts'
import { type Database, all, run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import { openTestDatabase, testConfig } from './harness.ts'

let database: Database | null = null

afterEach(async () => {
  await database?.close()
  database = null
})

const preparedRuntime = async (topics?: string) => {
  database = await openTestDatabase()
  const { env } = buildRuntime({
    config: testConfig(topics === undefined ? {} : { HB_TOPICS: topics }),
    database,
    clock: makeTestClock(1_700_000_000_000),
    log: () => {},
  })
  await T.runPromise(prepareDatabase, env)
  return env
}

const slugs = (env: Awaited<ReturnType<typeof preparedRuntime>>) =>
  T.runPromise(all<{ slug: string }>(sql`SELECT slug FROM topics ORDER BY slug`), env).then((rows) =>
    rows.map((row) => row.slug),
  )

describe('preparing the database', () => {
  it('creates the tables and no topic of its own, so an embedded server needs nothing else', async () => {
    expect(await slugs(await preparedRuntime())).toEqual([])
  })

  it('seeds exactly the configured topics and can run again on every start', async () => {
    const env = await preparedRuntime('billing: Invoices, general')
    await T.runPromise(prepareDatabase, env)
    expect(await slugs(env)).toEqual(['billing', 'general'])
  })

  it('joins nobody to a seeded topic and keeps an existing general topic with its members', async () => {
    const env = await preparedRuntime('general')
    await T.runPromise(
      T.gen(function* () {
        yield* run(sql`INSERT INTO members (id, email, subject, name, profile, role, status, event_seq, created_at)
          VALUES ('mem_ana', 'ana@example.com', 'dev:ana', 'Ana', '', 'member', 'active', 0, 1)`)
        const [general] = yield* all<{ conversation_id: string }>(
          sql`SELECT conversation_id FROM topics WHERE slug = 'general'`,
        )
        yield* run(
          sql`INSERT INTO participants (conversation_id, member_id) VALUES (${general?.conversation_id}, 'mem_ana')`,
        )
      }),
      env,
    )
    const restarted = { ...env, config: testConfig({ HB_TOPICS: 'billing' }) }
    await T.runPromise(prepareDatabase, restarted)
    expect(await slugs(restarted)).toEqual(['billing', 'general'])
    const members = await T.runPromise(
      all<{ slug: string; member_id: string }>(
        sql`SELECT t.slug, p.member_id FROM topics t JOIN participants p ON p.conversation_id = t.conversation_id`,
      ),
      restarted,
    )
    expect(members).toEqual([{ slug: 'general', member_id: 'mem_ana' }])
  })

  it('refuses to start on a database an earlier build made, seeding nothing', async () => {
    const env = await preparedRuntime()
    await T.runPromise(run(sql`INSERT INTO schema_versions (version) VALUES (8)`), env)
    const restarted = { ...env, config: testConfig({ HB_TOPICS: 'billing' }) }
    expect(await T.runPromise(T.result(prepareDatabase), restarted)).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'UnknownDatabase' },
    })
    expect(await slugs(restarted)).toEqual([])
  })
})
