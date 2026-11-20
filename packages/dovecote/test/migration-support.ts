import { Task as T } from '@homingbird/kernel'
import { type HasSql, all, run, sqlEnvironment } from '../src/sql/database.ts'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { raw } from '../src/sql/query.ts'
import type { Migration } from '../src/sql/schema-steps.ts'
import { migrateThrough } from '../src/sql/schema.ts'
import { openSqlite } from '../src/sql/sqlite.ts'

export interface MigratedDatabase {
  readonly env: HasSql
  readonly columnsOf: (table: string) => Promise<string[]>
  readonly indexesOf: (table: string) => Promise<string[]>
  readonly execute: (statement: string) => Promise<number>
  readonly migrate: (migrations: ReadonlyArray<Migration>) => Promise<ReadonlyArray<number>>
  readonly close: () => Promise<void>
}

/** An empty SQLite database brought up to the first `through` steps, to look at what each step adds. */
export const migratedThrough = async (through: number): Promise<MigratedDatabase> => {
  const database = openSqlite(':memory:')
  const env = sqlEnvironment(database)
  const migrate = (migrations: ReadonlyArray<Migration>) => T.runPromise(migrateThrough(migrations), env)
  await migrate(MIGRATIONS.slice(0, through))
  return {
    env,
    columnsOf: async (table) =>
      (await T.runPromise(all<{ name: string }>(raw(`PRAGMA table_info(${table})`)), env)).map(
        (row) => row.name,
      ),
    indexesOf: async (table) =>
      (await T.runPromise(all<{ name: string }>(raw(`PRAGMA index_list(${table})`)), env)).map(
        (row) => row.name,
      ),
    execute: (statement) => T.runPromise(run(raw(statement)), env),
    migrate,
    close: () => T.runPromise(database.close),
  }
}

export const stepNumberOf = (migration: Migration): number => MIGRATIONS.indexOf(migration) + 1

/**
 * Four channels before groups: payroll's managers are Ana, in the room, Cy, deactivated, and Dee, who
 * left the room; billing's only manager is Cy; lobby's is Dee; quiet has none.
 */
export const CHANNELS_WITH_MANAGERS: ReadonlyArray<string> = [
  ...(
    [
      ['ana', 'active'],
      ['ben', 'active'],
      ['cy', 'deactivated'],
      ['dee', 'active'],
    ] as const
  ).map(
    ([name, status]) =>
      `INSERT INTO members (id, email, subject, name, profile, role, status, event_seq, created_at) VALUES ('mem_${name}', '${name}@example.com', 'dev:${name}', '${name}', '', 'member', '${status}', 0, 1)`,
  ),
  ...['payroll', 'billing', 'lobby', 'quiet'].flatMap((slug, index) => [
    `INSERT INTO conversations (id, kind, title, created_at, last_activity_at) VALUES ('conv_${slug.padEnd(12, '0')}', 'channel', '${slug}', ${index + 10}, ${index + 10})`,
    `INSERT INTO channels (slug, description, conversation_id, created_by, created_at, visibility) VALUES ('${slug}', 'About ${slug}', 'conv_${slug.padEnd(12, '0')}', 'mem_ana', ${index + 10}, 'private')`,
  ]),
  ...[
    ['payroll', 'ana'],
    ['payroll', 'ben'],
    ['payroll', 'cy'],
    ['billing', 'cy'],
    ['billing', 'ben'],
    ['lobby', 'ana'],
  ].map(
    ([slug, name]) =>
      `INSERT INTO participants (conversation_id, member_id) VALUES ('conv_${slug!.padEnd(12, '0')}', 'mem_${name}')`,
  ),
  ...[
    ['payroll', 'ana'],
    ['payroll', 'cy'],
    ['payroll', 'dee'],
    ['billing', 'cy'],
    ['lobby', 'dee'],
  ].map(
    ([slug, name]) =>
      `INSERT INTO channel_managers (conversation_id, member_id) VALUES ('conv_${slug!.padEnd(12, '0')}', 'mem_${name}')`,
  ),
]

/**
 * What the groups step makes of `CHANNELS_WITH_MANAGERS`: a channel group for every channel, and Ana in
 * payroll's, the one active manager still in a room.
 */
export const GROUPS_FROM_MANAGERS = {
  groups: (['billing', 'lobby', 'payroll', 'quiet'] as const).map((slug) => ({
    id: `grp_${slug.padEnd(12, '0')}`,
    kind: 'channel',
    name: null,
    created_by: 'mem_ana',
    created_at: { payroll: 10, billing: 11, lobby: 12, quiet: 13 }[slug],
  })),
  members: [{ group_id: 'grp_payroll00000', member_id: 'mem_ana' }],
  channels: ['billing', 'lobby', 'payroll', 'quiet'].map((slug) => ({
    slug,
    manager_group_id: `grp_${slug.padEnd(12, '0')}`,
  })),
}

/** Reads back what `GROUPS_FROM_MANAGERS` describes, numbers as numbers whatever the database. */
export const groupsAndManagers = async (
  read: (query: string) => Promise<ReadonlyArray<Record<string, unknown>>>,
) => ({
  groups: (await read('SELECT id, kind, name, created_by, created_at FROM member_groups ORDER BY id')).map(
    (row) => ({ ...row, created_at: Number(row.created_at) }),
  ),
  members: await read('SELECT group_id, member_id FROM group_members ORDER BY group_id, member_id'),
  channels: await read('SELECT slug, manager_group_id FROM channels ORDER BY slug'),
})
