import { createHash } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import {
  AUDIT_EVENTS,
  AUDIT_TARGET_ID_MAX,
  type AuditDetail,
  type AuditEventName,
  type AuditOutcome,
  CARRIES_CLIENT_ADDRESS,
  type CredentialKind,
  type MemberId,
  isKeptAt,
} from '@homingbird/protocol'
import type { AppEnv, Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { type Dialect, type HasSql, all, dialect, first, inTransaction, run } from '../sql/database.ts'
import { insertIgnoringConflict, insertInto, sql } from '../sql/query.ts'

/**
 * Records one audit event in the transaction of the action it describes, chained to the row before it.
 * The detail is encoded with the event's schema first, so nothing the catalogue does not declare is kept.
 */
export const recordAudit = <N extends AuditEventName>(
  event: N,
  input: AuditInput<N>,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const tier = env.config.logs.audit
    if (tier === 'off' || !isKeptAt(tier, event)) return
    const declared = AUDIT_EVENTS[event]
    const detail = declared.detail.decode(input.detail)
    if (detail._tag === 'Err')
      env.log.emit({ name: 'audit.invalid_detail', attributes: { event } }, env.requestId)
    const client = CARRIES_CLIENT_ADDRESS.includes(event) ? env.client : null
    const head = yield* lockedHead
    const row: UnhashedRow = {
      created_at: env.clock.now(),
      event,
      outcome: input.outcome ?? 'success',
      actor_id: input.caller?.member.id ?? input.actorId ?? null,
      credential_id: input.caller?.credential.id ?? null,
      credential_kind: input.caller?.credential.kind ?? null,
      client_id: input.clientId?.slice(0, AUDIT_TARGET_ID_MAX) ?? null,
      target_kind: declared.target,
      target_id: input.targetId?.slice(0, AUDIT_TARGET_ID_MAX) ?? null,
      request_id: env.requestId,
      client_address: client?.address.slice(0, STRING_COLUMN_MAX) ?? null,
      user_agent: client?.userAgent.slice(0, USER_AGENT_MAX) ?? null,
      detail: canonicalJson(detail._tag === 'Ok' ? detail.value : { invalidDetail: true }),
      previous_hash: head.hash,
    }
    const hash = hashOf(row)
    yield* run(insertInto('audit_events', { ...row, hash }))
    const inserted = yield* first<{ id: number | null }>(sql`SELECT MAX(id) AS id FROM audit_events`)
    yield* run(
      sql`UPDATE audit_head SET last_id = ${Number(inserted?.id ?? 0)}, hash = ${hash} WHERE name = ${CHAIN}`,
    )
    env.audited.push({
      event,
      outcome: input.outcome ?? 'success',
      actorId: row.actor_id,
      credentialId: row.credential_id,
      credentialKind: row.credential_kind,
      targetKind: row.target_kind,
      targetId: row.target_id,
    })
  })

export interface AuditInput<N extends AuditEventName> {
  readonly caller?: Caller | null
  /** The member acted for when no credential of theirs made the request, as when a token is issued. */
  readonly actorId?: MemberId | null
  readonly targetId?: string | null
  readonly clientId?: string | null
  readonly outcome?: AuditOutcome
  readonly detail: AuditDetail<N>
}

/** What may leave the audit trail as a copy on stdout: the row without its detail. */
export interface AuditCopy {
  readonly event: AuditEventName
  readonly outcome: AuditOutcome
  readonly actorId: string | null
  readonly credentialId: string | null
  readonly credentialKind: CredentialKind | null
  readonly targetKind: string
  readonly targetId: string | null
}

export type AuditVerdict =
  | { readonly ok: true; readonly rows: number; readonly head: string }
  | { readonly ok: false; readonly id: number; readonly problem: string }

/**
 * Walks the chain up to the head read when it starts, so rows written meanwhile wait for the next run
 * and a purge meanwhile, which leaves its anchor, is no break.
 */
export const verifyAudit: T.Task<AuditVerdict, never, HasSql> = T.suspend(() => verifyChain(VERIFY_PAGE))

export const verifyChain = (pageSize: number): T.Task<AuditVerdict, never, HasSql> =>
  T.gen(function* () {
    const head = yield* headRow(CHAIN)
    const bound = { id: Number(head?.last_id ?? 0), hash: head?.hash ?? GENESIS }
    const anchor = yield* headRow(PURGED)
    return yield* walk(bound, pageSize, {
      after: 0,
      previous: null,
      rows: 0,
      anchors: anchor === null ? [] : [anchor.hash],
    })
  })

export const auditPage = (range: {
  readonly after: number
  readonly limit: number
  readonly since?: number
  readonly until?: number
}): T.Task<ReadonlyArray<StoredRow>, never, HasSql> =>
  all<StoredRow>(sql`
    SELECT * FROM audit_events
    WHERE id > ${range.after} AND created_at >= ${range.since ?? 0}
      AND created_at < ${range.until ?? Number.MAX_SAFE_INTEGER}
    ORDER BY id LIMIT ${range.limit}`)

export const exportedRow = (stored: StoredRow): Record<string, unknown> => {
  const row = normalized(stored)
  return {
    id: row.id,
    at: new Date(row.created_at).toISOString(),
    event: row.event,
    outcome: row.outcome,
    actorId: row.actor_id,
    credentialId: row.credential_id,
    credentialKind: row.credential_kind,
    clientId: row.client_id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    requestId: row.request_id,
    clientAddress: row.client_address,
    userAgent: row.user_agent,
    detail: JSON.parse(row.detail),
    previousHash: row.previous_hash,
    hash: row.hash,
  }
}

/** Removes rows of the first audit table, which hold note content, older than the cutoff. */
export const purgeLegacyAudit = (
  cutoff: number,
  because: 'upgrade' | 'command',
): T.Task<number, never, RequestEnv> =>
  T.gen(function* () {
    const removed = yield* run(sql`DELETE FROM audit_log WHERE created_at < ${cutoff}`)
    if (removed > 0) yield* recordAudit('audit.legacy_purged', { detail: { removed, because } })
    return removed
  })

/** Removes the oldest rows as one prefix, keeping the last removed hash so the rest still verifies. */
export const purgeAuditBefore = (cutoff: number): T.Task<number, never, RequestEnv> =>
  T.gen(function* () {
    const last = yield* first<{ id: number | null }>(
      sql`SELECT MAX(id) AS id FROM audit_events WHERE created_at < ${cutoff}`,
    )
    const lastId = last?.id === null || last?.id === undefined ? null : Number(last.id)
    const lastRow =
      lastId === null
        ? null
        : yield* first<{ hash: string }>(sql`SELECT hash FROM audit_events WHERE id = ${lastId}`)
    const removed = lastId === null ? 0 : yield* run(sql`DELETE FROM audit_events WHERE id <= ${lastId}`)
    const earlierRemoved = yield* run(sql`DELETE FROM audit_log WHERE created_at < ${cutoff}`)
    if (lastRow !== null) {
      yield* ensureHeadRow(PURGED)
      yield* run(
        sql`UPDATE audit_head SET last_id = ${lastId}, hash = ${lastRow.hash} WHERE name = ${PURGED}`,
      )
    }
    if (removed > 0 || earlierRemoved > 0)
      yield* recordAudit('audit.retention_purged', {
        detail: { removed, earlierRemoved, lastRemovedHash: lastRow?.hash ?? null },
      })
    return removed
  })

export const auditHead: T.Task<{ readonly id: number; readonly hash: string }, never, HasSql> = T.suspend(
  () =>
    T.map((row: { last_id: number; hash: string } | null) => ({
      id: Number(row?.last_id ?? 0),
      hash: row?.hash ?? GENESIS,
    }))(
      first<{ last_id: number; hash: string }>(
        sql`SELECT last_id, hash FROM audit_head WHERE name = ${CHAIN}`,
      ),
    ),
)

/** Creates the head row once, at start, so the first writers do not race to create it. */
export const prepareAuditHead: T.Task<void, never, AppEnv> = T.suspend(() =>
  inTransaction(T.asUnit(ensureHeadRow(CHAIN))),
)

export const GENESIS = '0'.repeat(64)

/** JSON with object keys in a fixed order, so the same row always hashes the same. */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  )

export interface StoredRow extends Record<string, unknown> {
  readonly id: number
  readonly hash: string
}

interface UnhashedRow {
  readonly created_at: number
  readonly event: string
  readonly outcome: string
  readonly actor_id: string | null
  readonly credential_id: string | null
  readonly credential_kind: CredentialKind | null
  readonly client_id: string | null
  readonly target_kind: string
  readonly target_id: string | null
  readonly request_id: string | null
  readonly client_address: string | null
  readonly user_agent: string | null
  readonly detail: string
  readonly previous_hash: string
}

interface NormalizedRow extends UnhashedRow {
  readonly id: number
  readonly hash: string
}

const CHAIN = 'chain'
const PURGED = 'purged'
const USER_AGENT_MAX = 200
/** The size of a `string` column on PostgreSQL and MySQL, which refuse a longer value. */
const STRING_COLUMN_MAX = 400
const VERIFY_PAGE = 1000

function ensureHeadRow(name: string): T.Task<number, never, HasSql> {
  return T.flatMap((target: Dialect) =>
    run(insertIgnoringConflict(target, 'audit_head', { name, last_id: 0, hash: GENESIS })),
  )(dialect)
}

/**
 * The head, locked for this transaction: `FOR UPDATE` on PostgreSQL and MySQL; SQLite's transactions
 * are `BEGIN IMMEDIATE`, so one writer holds the whole database already.
 */
const lockedHead: T.Task<{ readonly hash: string }, never, HasSql> = T.gen(function* () {
  const target = yield* dialect
  const locking = target === 'sqlite' ? sql`` : sql`FOR UPDATE`
  const head = yield* first<{ hash: string }>(
    sql`SELECT hash FROM audit_head WHERE name = ${CHAIN} ${locking}`,
  )
  if (head !== null) return head
  yield* ensureHeadRow(CHAIN)
  const made = yield* first<{ hash: string }>(
    sql`SELECT hash FROM audit_head WHERE name = ${CHAIN} ${locking}`,
  )
  return made ?? { hash: GENESIS }
})

interface WalkState {
  readonly after: number
  readonly previous: string | null
  readonly rows: number
  readonly anchors: ReadonlyArray<string>
}

const walk = (
  bound: { readonly id: number; readonly hash: string },
  pageSize: number,
  state: WalkState,
): T.Task<AuditVerdict, never, HasSql> =>
  T.gen(function* () {
    const page = yield* all<StoredRow>(sql`
      SELECT * FROM audit_events WHERE id > ${state.after} AND id <= ${bound.id} ORDER BY id LIMIT ${pageSize}`)
    const anchor = yield* headRow(PURGED)
    const known =
      anchor === null || state.anchors.includes(anchor.hash)
        ? state
        : { ...state, anchors: [...state.anchors, anchor.hash] }
    const checked = page.map(normalized).reduce(checkRow, known as WalkState | AuditVerdict)
    if ('ok' in checked) return checked
    if (page.length === pageSize) return yield* walk(bound, pageSize, checked)
    const reached = (checked.previous ?? GENESIS) === bound.hash || checked.anchors.includes(bound.hash)
    return reached
      ? { ok: true, rows: checked.rows, head: bound.hash }
      : { ok: false, id: checked.after, problem: 'the chain head names a row that is missing' }
  })

const checkRow = (state: WalkState | AuditVerdict, row: NormalizedRow): WalkState | AuditVerdict => {
  if ('ok' in state) return state
  const linked =
    row.previous_hash === (state.previous ?? GENESIS) || state.anchors.includes(row.previous_hash)
  if (!linked) return { ok: false, id: row.id, problem: 'its link does not match the row before it' }
  if (hashOf(withoutKeys(row)) !== row.hash)
    return { ok: false, id: row.id, problem: 'its hash does not match its content' }
  return { ...state, after: row.id, previous: row.hash, rows: state.rows + 1 }
}

const headRow = (
  name: string,
): T.Task<{ readonly last_id: number; readonly hash: string } | null, never, HasSql> =>
  first<{ last_id: number; hash: string }>(sql`SELECT last_id, hash FROM audit_head WHERE name = ${name}`)

const hashOf = (row: UnhashedRow): string =>
  createHash('sha256')
    .update(row.previous_hash)
    .update(canonicalJson(HASHED_COLUMNS.map((column) => row[column])))
    .digest('hex')

const HASHED_COLUMNS: ReadonlyArray<keyof UnhashedRow> = [
  'created_at',
  'event',
  'outcome',
  'actor_id',
  'credential_id',
  'credential_kind',
  'client_id',
  'target_kind',
  'target_id',
  'request_id',
  'client_address',
  'user_agent',
  'detail',
  'previous_hash',
]

const normalized = (stored: StoredRow): NormalizedRow => {
  const text = (column: string): string | null => {
    const value = stored[column]
    return value === null || value === undefined ? null : String(value)
  }
  return {
    id: Number(stored.id),
    created_at: Number(stored.created_at),
    event: String(stored.event),
    outcome: String(stored.outcome),
    actor_id: text('actor_id'),
    credential_id: text('credential_id'),
    credential_kind: text('credential_kind') as CredentialKind | null,
    client_id: text('client_id'),
    target_kind: String(stored.target_kind),
    target_id: text('target_id'),
    request_id: text('request_id'),
    client_address: text('client_address'),
    user_agent: text('user_agent'),
    detail: String(stored.detail),
    previous_hash: String(stored.previous_hash),
    hash: String(stored.hash),
  }
}

const withoutKeys = ({ id: _, hash: __, ...row }: NormalizedRow): UnhashedRow => row
