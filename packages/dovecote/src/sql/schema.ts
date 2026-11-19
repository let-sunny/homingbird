import { Task as T, tagged } from '@homingbird/kernel'
import { type Dialect, type HasSql, all, dialect, first, inTransaction, run } from './database.ts'
import { list, raw, sql } from './query.ts'

export const migrate: T.Task<void, UnknownDatabase, HasSql> = T.gen(function* () {
  yield* migrateThrough(MIGRATIONS)
})

export const migrateThrough = (migrations: ReadonlyArray<Migration>): T.Task<void, UnknownDatabase, HasSql> =>
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
    for (const [index, steps] of migrations.entries()) {
      const version = index + 1
      if (!applied.has(version)) yield* applying(target, steps, version)
    }
  })

export const UnknownDatabase = tagged('UnknownDatabase')<{ readonly message: string }>()
export type UnknownDatabase = ReturnType<typeof UnknownDatabase>

export const schemaStatements = (
  target: Dialect,
  migrations: ReadonlyArray<Migration> = MIGRATIONS,
): string[] => [VERSION_TABLE, ...migrations.flat()].flatMap((step) => statementsFor(target, step))

export const tableNames = (): string[] =>
  [VERSION_TABLE, ...MIGRATIONS.flat()].filter(isTable).map((table) => table.name)

export type Migration = ReadonlyArray<Step>

export type Step = Table | AddedColumn | AddedIndex | Backfill

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

interface AddedColumn {
  readonly addTo: string
  readonly name: string
  readonly column: Column & { readonly nullable: true }
}

interface AddedIndex {
  readonly indexOn: string
  readonly columns: ReadonlyArray<string>
}

interface Backfill {
  readonly backfill: string
}

const id: Column = { type: 'id' }
const optionalId: Column = { type: 'id', nullable: true }
const string: Column = { type: 'string' }
const optionalString = { type: 'string', nullable: true } as const satisfies Column
const text: Column = { type: 'text' }
const optionalText = { type: 'text', nullable: true } as const satisfies Column
const integer: Column = { type: 'integer' }
const optionalInteger = { type: 'integer', nullable: true } as const satisfies Column

const VERSION_TABLE: Table = {
  name: 'schema_versions',
  columns: { version: integer },
  primaryKey: ['version'],
}

const BASELINE: ReadonlyArray<Table> = [
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
      locale: optionalString,
      character_spec: optionalText,
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
      archived_at: optionalInteger,
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
      basis: optionalText,
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
  {
    name: 'push_subscriptions',
    columns: {
      endpoint_hash: string,
      member_id: id,
      endpoint: text,
      p256dh: string,
      auth: string,
      created_at: integer,
      locale: optionalString,
    },
    primaryKey: ['endpoint_hash'],
    indexes: [{ columns: ['member_id'] }],
  },
  {
    name: 'draft_requests',
    columns: {
      id,
      member_id: id,
      conversation_id: id,
      in_reply_to: optionalId,
      instruction: text,
      agent_id: optionalId,
      created_at: integer,
      expires_at: integer,
      cancelled_at: optionalInteger,
    },
    primaryKey: ['id'],
    indexes: [{ columns: ['member_id', 'expires_at'] }],
  },
  {
    name: 'draft_request_answers',
    columns: { request_id: id, note_id: id, credential_id: id },
    primaryKey: ['request_id', 'note_id'],
  },
  {
    name: 'channels',
    columns: {
      slug: id,
      description: string,
      conversation_id: id,
      created_by: optionalId,
      created_at: integer,
      visibility: optionalString,
    },
    primaryKey: ['slug'],
    indexes: [{ columns: ['conversation_id'], unique: true }],
  },
  {
    name: 'notices',
    columns: {
      member_id: id,
      note_id: id,
      conversation_id: id,
      kind: string,
      reason: optionalText,
      agent_name: optionalString,
      channel: optionalString,
      created_at: integer,
    },
    primaryKey: ['member_id', 'note_id'],
    indexes: [{ columns: ['member_id', 'conversation_id'] }],
  },
  {
    name: 'channel_answerers',
    columns: { conversation_id: id, member_id: id },
    primaryKey: ['conversation_id', 'member_id'],
    indexes: [{ columns: ['member_id'] }],
  },
  {
    name: 'channel_managers',
    columns: { conversation_id: id, member_id: id },
    primaryKey: ['conversation_id', 'member_id'],
    indexes: [{ columns: ['member_id'] }],
  },
]

const TEACHING_AND_FIGURES: Migration = [
  { addTo: 'notes', name: 'seen_at', column: optionalInteger },
  { addTo: 'notes', name: 'decided_at', column: optionalInteger },
  { addTo: 'notes', name: 'agent_body', column: optionalText },
  { addTo: 'notes', name: 'agent_client', column: optionalString },
  { addTo: 'notes', name: 'agent_model', column: optionalString },
  { addTo: 'notes', name: 'session_minutes', column: optionalInteger },
  { addTo: 'notes', name: 'context_percent', column: optionalInteger },
  { indexOn: 'notes', columns: ['status', 'sent_at'] },
  { indexOn: 'notes', columns: ['decided_at'] },
  {
    name: 'principles',
    columns: {
      id,
      member_id: id,
      kind: string,
      topic: string,
      rule: text,
      source: optionalText,
      place: optionalString,
      enabled: integer,
      origin: string,
      position: integer,
      created_at: integer,
      updated_at: integer,
      last_applied_at: optionalInteger,
      public_text: optionalText,
    },
    primaryKey: ['id'],
    indexes: [{ columns: ['member_id'] }],
  },
  {
    name: 'principle_applications',
    columns: {
      principle_id: id,
      note_id: id,
      member_id: id,
      created_at: integer,
      missed_at: optionalInteger,
    },
    primaryKey: ['principle_id', 'note_id'],
    indexes: [{ columns: ['member_id'] }, { columns: ['note_id'] }],
  },
  {
    name: 'principle_offers',
    columns: {
      id,
      member_id: id,
      note_id: id,
      conversation_id: id,
      place: optionalString,
      kind: string,
      suggested_change: optionalText,
      created_at: integer,
      closed_at: optionalInteger,
    },
    primaryKey: ['id'],
    indexes: [{ columns: ['member_id', 'created_at'] }],
  },
  {
    name: 'principle_quiet_places',
    columns: { member_id: id, place: string, created_at: integer },
    primaryKey: ['member_id', 'place'],
  },
  {
    name: 'releases',
    columns: {
      note_id: id,
      credential_id: id,
      member_id: id,
      conversation_id: id,
      reason: optionalText,
      created_at: integer,
    },
    primaryKey: ['note_id', 'credential_id'],
    indexes: [{ columns: ['member_id', 'created_at'] }, { columns: ['created_at'] }],
  },
]

const DEBATES: Migration = [
  { addTo: 'notes', name: 'debate_id', column: { type: 'id', nullable: true } },
  {
    name: 'debates',
    columns: {
      id,
      question: text,
      visibility: string,
      status: string,
      created_by: id,
      turns_per_agent: integer,
      total_turns: integer,
      minutes: integer,
      turn_characters: integer,
      created_at: integer,
      updated_at: integer,
      deadline_at: integer,
      concluded_at: optionalInteger,
      closed_at: optionalInteger,
      result: optionalText,
      result_by: optionalId,
      result_at: optionalInteger,
      result_round: integer,
      ended_because: optionalString,
    },
    primaryKey: ['id'],
    indexes: [{ columns: ['status', 'deadline_at'] }, { columns: ['visibility', 'created_at'] }],
  },
  {
    name: 'debate_members',
    columns: { debate_id: id, member_id: id, created_at: integer },
    primaryKey: ['debate_id', 'member_id'],
    indexes: [{ columns: ['member_id'] }],
  },
  {
    name: 'debate_participants',
    columns: { debate_id: id, member_id: id, credential_id: id, agent_name: string, created_at: integer },
    primaryKey: ['debate_id', 'member_id'],
    indexes: [{ columns: ['credential_id'] }],
  },
  {
    name: 'debate_turns',
    columns: {
      debate_id: id,
      position: integer,
      member_id: id,
      credential_id: id,
      agent_name: string,
      body: text,
      created_at: integer,
    },
    primaryKey: ['debate_id', 'position'],
  },
  {
    name: 'debate_approvals',
    columns: { debate_id: id, member_id: id, approved_at: integer },
    primaryKey: ['debate_id', 'member_id'],
  },
  {
    name: 'debate_credits',
    columns: { debate_id: id, member_id: id, kind: string, created_at: integer },
    primaryKey: ['debate_id', 'member_id', 'kind'],
    indexes: [{ columns: ['member_id'] }],
  },
]

export const MIGRATIONS: ReadonlyArray<Migration> = [BASELINE, TEACHING_AND_FIGURES, DEBATES]

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
