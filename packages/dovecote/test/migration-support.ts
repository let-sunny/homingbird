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
