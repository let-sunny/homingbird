import { Task as T } from '@homingbird/kernel'
import type { MemberId } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { hashSecret } from '../random.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'

export type AuthRequestKind = 'sign_in' | 'authorize' | 'device' | 'join'
export type AuthRequestStatus = 'pending' | 'approved' | 'denied' | 'consumed'

export interface AuthRequest<Detail> {
  readonly id: string
  readonly kind: AuthRequestKind
  readonly status: AuthRequestStatus
  readonly userCode: string | null
  readonly memberId: MemberId | null
  readonly detail: Detail
  readonly expiresAt: number
}

export interface NewAuthRequest<Detail> {
  readonly kind: AuthRequestKind
  readonly detail: Detail
  readonly lifetimeMs: number
  readonly id?: string
  readonly secret?: string
  readonly userCode?: string
  readonly memberId?: MemberId
}

export const openAuthRequest = <Detail>(
  request: NewAuthRequest<Detail>,
): T.Task<AuthRequest<Detail>, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const now = env.clock.now()
    const opened: AuthRequest<Detail> = {
      id: request.id ?? env.random.identifier(),
      kind: request.kind,
      status: 'pending',
      userCode: request.userCode ?? null,
      memberId: request.memberId ?? null,
      detail: request.detail,
      expiresAt: now + request.lifetimeMs,
    }
    yield* run(
      insertInto('auth_requests', {
        id: opened.id,
        kind: opened.kind,
        status: opened.status,
        secret_hash: request.secret === undefined ? null : hashSecret(request.secret),
        user_code: opened.userCode,
        member_id: opened.memberId,
        detail: JSON.stringify(opened.detail),
        created_at: now,
        expires_at: opened.expiresAt,
      }),
    )
    return opened
  })

export const authRequestById = <Detail>(kind: AuthRequestKind, id: string) =>
  liveRequest<Detail>(sql`SELECT * FROM auth_requests WHERE kind = ${kind} AND id = ${id}`)

export const authRequestBySecret = <Detail>(kind: AuthRequestKind, secret: string) =>
  liveRequest<Detail>(
    sql`SELECT * FROM auth_requests WHERE kind = ${kind} AND secret_hash = ${hashSecret(secret)}`,
  )

export const authRequestByUserCode = <Detail>(userCode: string) =>
  liveRequest<Detail>(sql`SELECT * FROM auth_requests WHERE kind = 'device' AND user_code = ${userCode}`)

export interface AuthRequestChange {
  readonly status: AuthRequestStatus
  readonly expectedStatus: AuthRequestStatus
  readonly memberId?: MemberId
  readonly secret?: string
  readonly detail?: unknown
}

export const advanceAuthRequest = (id: string, change: AuthRequestChange): T.Task<boolean, never, AppEnv> =>
  T.gen(function* () {
    const changed = yield* run(
      sql`UPDATE auth_requests SET status = ${change.status} WHERE id = ${id} AND status = ${change.expectedStatus}`,
    )
    if (changed === 0) return false
    if (change.memberId !== undefined)
      yield* run(sql`UPDATE auth_requests SET member_id = ${change.memberId} WHERE id = ${id}`)
    if (change.secret !== undefined)
      yield* run(sql`UPDATE auth_requests SET secret_hash = ${hashSecret(change.secret)} WHERE id = ${id}`)
    if (change.detail !== undefined)
      yield* run(sql`UPDATE auth_requests SET detail = ${JSON.stringify(change.detail)} WHERE id = ${id}`)
    return true
  })

export const deleteExpiredAuthRequests = (now: number): T.Task<number, never, AppEnv> =>
  run(sql`DELETE FROM auth_requests WHERE expires_at < ${now}`)

interface AuthRequestRow {
  readonly id: string
  readonly kind: AuthRequestKind
  readonly status: AuthRequestStatus
  readonly user_code: string | null
  readonly member_id: MemberId | null
  readonly detail: string
  readonly expires_at: number
}

const liveRequest = <Detail>(
  query: Parameters<typeof first>[0],
): T.Task<AuthRequest<Detail> | null, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const row = yield* first<AuthRequestRow>(query)
    if (row === null || row.expires_at <= env.clock.now()) return null
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      userCode: row.user_code,
      memberId: row.member_id,
      detail: JSON.parse(row.detail) as Detail,
      expiresAt: row.expires_at,
    }
  })
