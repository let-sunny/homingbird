import { Task as T, tagged } from '@homingbird/kernel'
import { type Dialect, type HasSql, all, dialect, first, inTransaction, run } from './database.ts'
import { MIGRATIONS } from './migrations.ts'
import { list, raw, sql } from './query.ts'
import {
  type AddedColumn,
  type AddedIndex,
  type Column,
  type ColumnType,
  type Migration,
  type Step,
  type Table,
  integer,
} from './schema-steps.ts'

/** Brings the database to the current schema and says which steps it applied. */
export const migrate: T.Task<ReadonlyArray<number>, UnknownDatabase, HasSql> = T.suspend(() =>
  migrateThrough(MIGRATIONS),
)

export const migrateThrough = (
  migrations: ReadonlyArray<Migration>,
): T.Task<ReadonlyArray<number>, UnknownDatabase, HasSql> =>
  T.gen(function* () {
    const target = yield* dialect
    yield* run(raw(createTable(target, VERSION_TABLE)))
    const applied = new Set(
      (yield* all<{ version: number }>(sql`SELECT version FROM schema_versions`)).map((r) =>
        Number(r.version),
      ),
    )
    const unknown = [...applied].some((version) => version < 1 || version > migrations.length)
    if (unknown || (applied.size === 0 && (yield* hasTablesOf(target, migrations))))
      return yield* T.fail(UnknownDatabase({ message: UNKNOWN_DATABASE }))
    const appliedNow: number[] = []
    for (const [index, steps] of migrations.entries()) {
      const version = index + 1
      if (applied.has(version)) continue
      yield* applying(target, steps, version)
      appliedNow.push(version)
    }
    return appliedNow
  })

/**
 * Refuses, without changing anything, a database whose schema is not exactly this build's: a command
 * that only reads, such as `dovecote audit verify`, must not migrate.
 */
export const requireCurrentSchema: T.Task<void, UnknownDatabase, HasSql> = T.gen(function* () {
  const read = yield* T.exit(all<{ version: number }>(sql`SELECT version FROM schema_versions`))
  const versions = read._tag === 'Ok' ? read.value.map((row) => Number(row.version)) : []
  const newest = Math.max(0, ...versions)
  if (newest < MIGRATIONS.length)
    return yield* T.fail(
      UnknownDatabase({
        message:
          'This database is older than this Dovecote: start the server once to upgrade it, then run the command again.',
      }),
    )
  if (newest > MIGRATIONS.length) return yield* T.fail(UnknownDatabase({ message: UNKNOWN_DATABASE }))
})

export const UnknownDatabase = tagged('UnknownDatabase')<{ readonly message: string }>()
export type UnknownDatabase = ReturnType<typeof UnknownDatabase>

export const schemaStatements = (
  target: Dialect,
  migrations: ReadonlyArray<Migration> = MIGRATIONS,
): string[] => [VERSION_TABLE, ...migrations.flat()].flatMap((step) => statementsFor(target, step))

export const tableNames = (): string[] =>
  [VERSION_TABLE, ...MIGRATIONS.flat()].filter(isTable).map((table) => table.name)

const VERSION_TABLE: Table = {
  name: 'schema_versions',
  columns: { version: integer },
  primaryKey: ['version'],
}

const UNKNOWN_DATABASE =
  'This database was not made by this version of Dovecote, so it is left untouched: start Dovecote with an empty database.'

const applying = (target: Dialect, steps: Migration, version: number): T.Task<void, never, HasSql> =>
  inTransaction(
    T.gen(function* () {
      for (const step of steps) {
        if (target === 'mysql' && (yield* isAlreadyApplied(step))) continue
        for (const statement of statementsFor(target, step)) yield* run(raw(statement))
      }
      yield* run(sql`INSERT INTO schema_versions (version) VALUES (${version})`)
    }),
  )

/**
 * MySQL commits each change to a table as it runs it, so a step cut off halfway leaves some of it
 * applied; running it again skips a column or an index that is already there.
 */
const isAlreadyApplied = (step: Step): T.Task<boolean, never, HasSql> => {
  if ('addTo' in step)
    return T.map((found: unknown) => found !== null)(
      first(sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ${step.addTo} AND column_name = ${step.name}`),
    )
  if ('indexOn' in step)
    return T.map((found: unknown) => found !== null)(
      first(sql`SELECT index_name FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = ${step.indexOn}
        AND index_name = ${`${step.indexOn}_${step.columns.join('_')}_idx`}`),
    )
  return T.succeed(false)
}

const hasTablesOf = (target: Dialect, migrations: ReadonlyArray<Migration>): T.Task<boolean, never, HasSql> =>
  T.gen(function* () {
    const tables = migrations.flat().filter(isTable)
    if (tables.length === 0) return false
    const names = list(tables.map((table) => table.name))
    const found = yield* first(
      target === 'sqlite'
        ? sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ${names}`
        : target === 'postgres'
          ? sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ${names}`
          : sql`SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ${names}`,
    )
    return found !== null
  })

const isTable = (step: Step): step is Table => 'primaryKey' in step

const statementsFor = (target: Dialect, step: Step): string[] => {
  if ('backfill' in step) return [step.backfill]
  if ('indexOn' in step) return [addIndex(target, step)]
  if (!isTable(step)) return [addColumn(target, step)]
  return target === 'mysql'
    ? [createTable(target, step)]
    : [createTable(target, step), ...(step.indexes ?? []).map((index) => createIndex(step, index))]
}

const addColumn = (target: Dialect, added: AddedColumn): string =>
  `ALTER TABLE ${added.addTo} ADD COLUMN ${columnDefinition(target, added.name, added.column)}`

const addIndex = (target: Dialect, added: AddedIndex): string =>
  `CREATE INDEX ${target === 'mysql' ? '' : 'IF NOT EXISTS '}${added.indexOn}_${added.columns.join('_')}_idx ON ${added.indexOn} (${added.columns.join(', ')})`

const createTable = (target: Dialect, table: Table): string => {
  const columns = Object.entries(table.columns).map(([name, column]) =>
    columnDefinition(target, name, column),
  )
  const serialKey = Object.values(table.columns).some((column) => column.type === 'serial')
  const primaryKey = serialKey ? [] : [`PRIMARY KEY (${table.primaryKey.join(', ')})`]
  const inlineIndexes =
    target === 'mysql'
      ? (table.indexes ?? []).map(
          (index) =>
            `${index.unique ? 'UNIQUE ' : ''}INDEX ${indexName(table, index.columns)} (${index.columns.join(', ')})`,
        )
      : []
  return `CREATE TABLE IF NOT EXISTS ${table.name} (${[...columns, ...primaryKey, ...inlineIndexes].join(', ')})`
}

const createIndex = (table: Table, index: NonNullable<Table['indexes']>[number]): string =>
  `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${indexName(table, index.columns)} ON ${table.name} (${index.columns.join(', ')})`

const indexName = (table: Table, columns: ReadonlyArray<string>): string =>
  `${table.name}_${columns.join('_')}_idx`

const columnDefinition = (target: Dialect, name: string, column: Column): string =>
  column.type === 'serial'
    ? `${name} ${SERIAL[target]}`
    : `${name} ${COLUMN_TYPES[target][column.type]}${column.nullable ? '' : ' NOT NULL'}`

const SERIAL: Readonly<Record<Dialect, string>> = {
  sqlite: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  postgres: 'BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
  mysql: 'BIGINT AUTO_INCREMENT PRIMARY KEY',
}

const COLUMN_TYPES: Readonly<Record<Dialect, Readonly<Record<Exclude<ColumnType, 'serial'>, string>>>> = {
  sqlite: { id: 'TEXT', string: 'TEXT', text: 'TEXT', integer: 'INTEGER' },
  postgres: { id: 'VARCHAR(64)', string: 'VARCHAR(400)', text: 'TEXT', integer: 'BIGINT' },
  mysql: { id: 'VARCHAR(64)', string: 'VARCHAR(400)', text: 'MEDIUMTEXT', integer: 'BIGINT' },
}
