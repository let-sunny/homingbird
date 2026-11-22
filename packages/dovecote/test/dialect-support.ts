import { MIGRATIONS } from '../src/sql/migrations.ts'

/**
 * The databases a test that compares dialects runs on: SQLite always, PostgreSQL and MySQL when their URL
 * is set. A run whose `HB_TEST_DATABASE_URL` names PostgreSQL or MySQL is CI's run for that database, so
 * a missing URL there would skip that database's variants without a word: it fails instead.
 */
export const testDialects = (
  env: Readonly<Record<string, string | undefined>>,
): ReadonlyArray<readonly [name: string, url: string | undefined]> => {
  const named = env.HB_TEST_DATABASE_URL ?? ''
  const servers = [
    ['PostgreSQL', 'postgres', 'HB_TEST_POSTGRES_URL'],
    ['MySQL', 'mysql', 'HB_TEST_MYSQL_URL'],
  ] as const
  for (const [name, scheme, variable] of servers)
    if (named.startsWith(scheme) && env[variable] === undefined)
      throw new Error(
        `HB_TEST_DATABASE_URL names ${name}, but ${variable} is not set: set it to run the ${name} variants.`,
      )
  return [
    ['SQLite', 'sqlite::memory:'],
    ...servers.map(([name, , variable]) => [name, env[variable]] as const),
  ]
}

export const TEST_DIALECTS = testDialects(process.env)

/**
 * How long a test that migrates a database from empty or from an old release may take. MySQL commits each
 * change to a table on its own, so there the time grows with every migration step; elsewhere the default holds.
 */
export const migrationTimeout = (url: string | undefined): number | undefined =>
  url?.startsWith('mysql') === true ? DEFAULT_TIMEOUT_MS + MIGRATIONS.length * MYSQL_MS_PER_STEP : undefined

const DEFAULT_TIMEOUT_MS = 5000
const MYSQL_MS_PER_STEP = 500
