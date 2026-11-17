import { Task as T } from '@homingbird/kernel'
import type { AuditEntry, MemberId } from '@homingbird/protocol'
import type { AppEnv, Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'

export type AuditRecord = Omit<AuditEntry, 'id'>

export interface AuditInput {
  readonly caller: Caller | null
  readonly action: string
  readonly target?: string | null
  readonly detail?: unknown
}

export const recordAudit = (input: AuditInput): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const record: AuditRecord = {
      at: env.clock.now(),
      actorId: input.caller?.member.id ?? null,
      credentialId: input.caller?.credential.id ?? null,
      credentialKind: input.caller?.credential.kind ?? null,
      action: input.action,
      target: input.target ?? null,
      detail: input.detail ?? {},
    }
    yield* run(
      insertInto('audit_log', {
        created_at: record.at,
        actor_id: record.actorId,
        credential_id: record.credentialId,
        credential_kind: record.credentialKind,
        action: record.action,
        target: record.target,
        detail: JSON.stringify(record.detail),
      }),
    )
    env.audited.push(record)
  })

export interface AuditFilter {
  readonly before: number | null
  readonly limit: number
  readonly actorId?: MemberId
  readonly action?: string
}

export const listAudit = (filter: AuditFilter): T.Task<{ entries: AuditEntry[]; hasMore: boolean }, never, AppEnv> =>
  T.gen(function* () {
    const byActor = filter.actorId === undefined ? sql`` : sql`AND actor_id = ${filter.actorId}`
    const byAction = filter.action === undefined ? sql`` : sql`AND action = ${filter.action}`
    const rows = yield* all<AuditRow>(sql`
      SELECT * FROM audit_log WHERE id < ${filter.before ?? Number.MAX_SAFE_INTEGER} ${byActor} ${byAction}
      ORDER BY id DESC LIMIT ${filter.limit + 1}`)
    return { entries: rows.slice(0, filter.limit).map(toEntry), hasMore: rows.length > filter.limit }
  })

export const deleteAuditBefore = (cutoff: number): T.Task<number, never, AppEnv> =>
  run(sql`DELETE FROM audit_log WHERE created_at < ${cutoff}`)

interface AuditRow {
  readonly id: number
  readonly created_at: number
  readonly actor_id: AuditEntry['actorId']
  readonly credential_id: AuditEntry['credentialId']
  readonly credential_kind: AuditEntry['credentialKind']
  readonly action: string
  readonly target: string | null
  readonly detail: string
}

const toEntry = (row: AuditRow): AuditEntry => ({
  id: Number(row.id),
  at: row.created_at,
  actorId: row.actor_id,
  credentialId: row.credential_id,
  credentialKind: row.credential_kind,
  action: row.action,
  target: row.target,
  detail: JSON.parse(row.detail),
})
