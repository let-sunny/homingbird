import { Task as T } from '@homingbird/kernel'
import { type Dialect, type HasSql, all, dialect, inTransaction, run } from './database.ts'
import { raw, sql } from './query.ts'

export const migrate: T.Task<void, never, HasSql> = T.gen(function* () {
  const target = yield* dialect
  yield* run(raw(createTable(target, VERSION_TABLE)))
  const applied = new Set(
    (yield* all<{ version: number }>(sql`SELECT version FROM schema_versions`)).map((r) => r.version),
  )
  for (const [index, tables] of MIGRATIONS.entries()) {
    const version = index + 1
    if (applied.has(version)) continue
    yield* inTransaction(
      T.gen(function* () {
        for (const statement of tables.flatMap((table) => statementsFor(target, table)))
          yield* run(raw(statement))
        yield* run(sql`INSERT INTO schema_versions (version) VALUES (${version})`)
      }),
    )
  }
})

export const schemaStatements = (target: Dialect): string[] =>
  [VERSION_TABLE, ...MIGRATIONS.flat()].flatMap((table) => statementsFor(target, table))

export const tableNames = (): string[] => [VERSION_TABLE, ...MIGRATIONS.flat()].map((table) => table.name)

type ColumnType = 'id' | 'string' | 'text' | 'integer' | 'serial'

interface Column {
  readonly type: ColumnType
  readonly nullable?: true
}

interface Table {
  readonly name: string
  readonly columns: Readonly<Record<string, Column>>
  readonly primaryKey: ReadonlyArray<string>
  readonly indexes?: ReadonlyArray<{ readonly columns: ReadonlyArray<string>; readonly unique?: true }>
}

const id: Column = { type: 'id' }
const optionalId: Column = { type: 'id', nullable: true }
const string: Column = { type: 'string' }
const optionalString: Column = { type: 'string', nullable: true }
const text: Column = { type: 'text' }
const integer: Column = { type: 'integer' }
const optionalInteger: Column = { type: 'integer', nullable: true }

const VERSION_TABLE: Table = {
  name: 'schema_versions',
  columns: { version: integer },
  primaryKey: ['version'],
}

const INITIAL: ReadonlyArray<Table> = [
  {
    name: 'members',
    columns: {
      id,
      email: string,
      subject: string,
      name: string,
      profile: text,
      role: string,
      status: string,
      event_seq: integer,
      created_at: integer,
      last_seen_at: optionalInteger,
    },
    primaryKey: ['id'],
    indexes: [
      { columns: ['email'], unique: true },
      { columns: ['subject'], unique: true },
    ],
  },
  { name: 'settings', columns: { name: string, value: text }, primaryKey: ['name'] },
  {
    name: 'credentials',
    columns: {
      id,
      member_id: id,
      kind: string,
      name: string,
      client: string,
      token_hash: string,
      refresh_hash: optionalString,
      token_expires_at: integer,
      expires_at: integer,
      created_at: integer,
      last_used_at: optionalInteger,
      revoked_at: optionalInteger,
    },
    primaryKey: ['id'],
    indexes: [
      { columns: ['token_hash'], unique: true },
      { columns: ['refresh_hash'] },
      { columns: ['member_id'] },
    ],
  },
  {
    name: 'oauth_clients',
    columns: { id, name: string, redirect_uris: text, created_at: integer },
    primaryKey: ['id'],
  },
  {
    name: 'auth_requests',
    columns: {
      id,
      kind: string,
      status: string,
      secret_hash: optionalString,
      user_code: optionalString,
      member_id: optionalId,
      detail: text,
      created_at: integer,
      expires_at: integer,
    },
    primaryKey: ['id'],
    indexes: [{ columns: ['secret_hash'] }, { columns: ['user_code'] }, { columns: ['expires_at'] }],
  },
  {
    name: 'conversations',
    columns: {
      id,
      kind: string,
      title: optionalString,
      pair_key: optionalString,
      created_at: integer,
      last_activity_at: integer,
    },
    primaryKey: ['id'],
    indexes: [{ columns: ['pair_key'], unique: true }],
  },
  {
    name: 'participants',
    columns: { conversation_id: id, member_id: id },
    primaryKey: ['conversation_id', 'member_id'],
    indexes: [{ columns: ['member_id'] }],
  },
  {
    name: 'notes',
    columns: {
      id,
      conversation_id: id,
      author_id: id,
      status: string,
      body: text,
      in_reply_to: optionalId,
      origin: string,
      agent_name: optionalString,
      credential_id: optionalId,
      created_at: integer,
      updated_at: integer,
      sent_at: optionalInteger,
    },
    primaryKey: ['id'],
    indexes: [
      { columns: ['conversation_id', 'status', 'sent_at'] },
      { columns: ['author_id', 'status'] },
      { columns: ['in_reply_to'] },
    ],
  },
  {
    name: 'receipts',
    columns: {
      note_id: id,
      member_id: id,
      delivered_at: integer,
      read_at: optionalInteger,
      drafting_at: optionalInteger,
      replied_at: optionalInteger,
    },
    primaryKey: ['note_id', 'member_id'],
    indexes: [{ columns: ['member_id', 'replied_at'] }],
  },
  {
    name: 'pickups',
    columns: { note_id: id, credential_id: id, picked_at: integer },
    primaryKey: ['note_id', 'credential_id'],
  },
  {
    name: 'contacts',
    columns: {
      low_id: id,
      high_id: id,
      requested_by: id,
      status: string,
      created_at: integer,
    },
    primaryKey: ['low_id', 'high_id'],
    indexes: [{ columns: ['high_id'] }],
  },
  {
    name: 'blocks',
    columns: { blocker_id: id, blocked_id: id, created_at: integer },
    primaryKey: ['blocker_id', 'blocked_id'],
    indexes: [{ columns: ['blocked_id'] }],
  },
  {
    name: 'events',
    columns: { member_id: id, seq: integer, created_at: integer, body: text },
    primaryKey: ['member_id', 'seq'],
    indexes: [{ columns: ['created_at'] }],
  },
  {
    name: 'audit_log',
    columns: {
      id: { type: 'serial' },
      created_at: integer,
      actor_id: optionalId,
      credential_id: optionalId,
      credential_kind: optionalString,
      action: string,
      target: optionalString,
      detail: text,
    },
    primaryKey: ['id'],
    indexes: [{ columns: ['created_at'] }, { columns: ['actor_id'] }],
  },
]

const PUSH_SUBSCRIPTIONS: ReadonlyArray<Table> = [
  {
    name: 'push_subscriptions',
    columns: {
      endpoint_hash: string,
      member_id: id,
      endpoint: text,
      p256dh: string,
      auth: string,
      created_at: integer,
    },
    primaryKey: ['endpoint_hash'],
    indexes: [{ columns: ['member_id'] }],
  },
]

const MIGRATIONS: ReadonlyArray<ReadonlyArray<Table>> = [INITIAL, PUSH_SUBSCRIPTIONS]

const statementsFor = (target: Dialect, table: Table): string[] =>
  target === 'mysql'
    ? [createTable(target, table)]
    : [createTable(target, table), ...(table.indexes ?? []).map((index) => createIndex(table, index))]

const createTable = (target: Dialect, table: Table): string => {
  const columns = Object.entries(table.columns).map(([name, column]) =>
    columnDefinition(target, table, name, column),
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

const columnDefinition = (target: Dialect, _table: Table, name: string, column: Column): string =>
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
