import { Task as T, makeTestClock } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareDatabase } from '../src/prepare-database.ts'
import { buildRuntime } from '../src/runtime.ts'
import { type Database, all } from '../src/sql/database.ts'
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
  it('creates the tables and the general topic, so an embedded server needs nothing else', async () => {
    expect(await slugs(await preparedRuntime())).toEqual(['general'])
  })

  it('seeds the configured topics and can run again on every start', async () => {
    const env = await preparedRuntime('billing: Invoices')
    await T.runPromise(prepareDatabase, env)
    expect(await slugs(env)).toEqual(['billing', 'general'])
  })
})
