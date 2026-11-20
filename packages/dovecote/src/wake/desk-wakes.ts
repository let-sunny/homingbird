import { Schema as S, Task as T } from '@homingbird/kernel'
import {
  type CredentialId,
  type DeskWake,
  DeskWakeHeader,
  type DeskWakeSetup,
  type DeskWakeStatus,
  type DeskWakeStop,
  Invalid,
  type MemberId,
  NotFound,
} from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import type { AppEnv, Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { SEALING_NONCE_BYTES, openSealed, sealSecret } from './sealing.ts'
import type { WakeAfter } from './wake-schedule.ts'
import { type WakeTarget, wakeHostOf, wakeTargetProblem } from './wake-target.ts'

/** Read back with the host and header names, never the path or a value. */
export const deskWakeOf = (memberId: MemberId): T.Task<DeskWake | null, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const row = yield* wakeRowOf(memberId)
    return row === null ? null : describe(row, openWakeTarget(env.config.secretsKey, row))
  })

/** Replaces any earlier wake in full, so no old address or token survives a change. */
export const registerDeskWake = (
  caller: Caller,
  setup: DeskWakeSetup,
): T.Task<DeskWake, Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const key = env.config.secretsKey
    const memberId = caller.member.id
    const target: WakeTarget = { url: setup.url, headers: setup.headers }
    const problem = wakeTargetProblem(target, env.config.wakeHosts)
    if (problem !== null) return yield* T.fail(Invalid({ message: problem }))
    if (!(yield* isOwnAgentCredential(memberId, setup.credentialId)))
      return yield* T.fail(Invalid({ message: 'Choose one of your own agent connections that still works.' }))
    if (key === null)
      return yield* T.fail(Invalid({ message: 'This server has no key to keep a wake with.' }))
    const now = env.clock.now()
    const earlier = yield* wakeRowOf(memberId)
    const sealed = sealSecret(key, JSON.stringify(target), memberId, env.random.bytes(SEALING_NONCE_BYTES))
    yield* run(sql`DELETE FROM desk_wakes WHERE member_id = ${memberId}`)
    yield* run(
      insertInto('desk_wakes', {
        member_id: memberId,
        credential_id: setup.credentialId,
        host: wakeHostOf(target),
        sealed,
        enabled: setup.enabled ? 1 : 0,
        last_wake_at: null,
        last_status: 'never',
        failures: 0,
        retry_at: null,
        stopped_because: null,
        created_at: earlier === null ? now : Number(earlier.created_at),
        updated_at: now,
      }),
    )
    return (yield* deskWakeOf(memberId))!
  })

export const removeDeskWake = (memberId: MemberId): T.Task<void, NotFound, RequestEnv> =>
  T.gen(function* () {
    const removed = yield* run(sql`DELETE FROM desk_wakes WHERE member_id = ${memberId}`)
    if (removed === 0) return yield* T.fail(NotFound({ message: 'No cloud desk wake is set up.' }))
  })

export const forgetDeskWake = (actor: Caller, memberId: MemberId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const row = yield* wakeRowOf(memberId)
    if (row === null) return
    yield* run(sql`DELETE FROM desk_wakes WHERE member_id = ${memberId}`)
    yield* recordAudit('desk_wake.removed', {
      caller: actor,
      targetId: memberId,
      detail: { host: row.host, because: 'deactivated' },
    })
  })

export const deskWakeHostOf = (memberId: MemberId): T.Task<string, never, AppEnv> =>
  T.map((row: WakeRow | null) => row?.host ?? '')(wakeRowOf(memberId))

/** The credential a cloud desk is woken for, which `/mcp` serves as a desk. */
export const isWakeBound = (caller: Caller): T.Task<boolean, never, AppEnv> =>
  T.map((row: unknown) => row !== null)(
    first(sql`
      SELECT member_id FROM desk_wakes
      WHERE member_id = ${caller.member.id} AND credential_id = ${caller.credential.id} AND enabled = 1
        AND stopped_because IS NULL`),
  )

export const openWakeTarget = (
  key: Buffer | null,
  row: Pick<WakeRow, 'sealed' | 'member_id'>,
): WakeTarget | null => {
  const opened = key === null ? null : openSealed(key, row.sealed, row.member_id)
  if (opened === null) return null
  const target = SealedTarget.decode(JSON.parse(opened))
  return target._tag === 'Ok' ? target.value : null
}

/**
 * Every write about a wake names the sealed value it read: a fresh nonce makes each save's value new,
 * so a wake replaced or removed while a request was out keeps nothing that request learned.
 */
export const stopDeskWake = (row: WakeRow, because: DeskWakeStop): T.Task<boolean, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const changed = yield* run(sql`
      UPDATE desk_wakes SET stopped_because = ${because}, retry_at = NULL, updated_at = ${env.clock.now()}
      WHERE member_id = ${row.member_id} AND sealed = ${row.sealed} AND stopped_because IS NULL`)
    if (changed === 0) return false
    yield* recordAudit('desk_wake.stopped', {
      actorId: row.member_id,
      targetId: row.member_id,
      detail: { host: row.host, because },
    })
    return true
  })

export const recordWakeOutcome = (
  row: WakeRow,
  after: WakeAfter,
  wokenAt: number | null,
): T.Task<boolean, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const lastWakeAt = wokenAt ?? numberOrNull(row.last_wake_at)
    const changed = yield* run(sql`
      UPDATE desk_wakes SET last_wake_at = ${lastWakeAt}, last_status = ${after.lastStatus},
        failures = ${after.failures}, retry_at = ${after.retryAt}, updated_at = ${env.clock.now()}
      WHERE member_id = ${row.member_id} AND sealed = ${row.sealed}`)
    return changed > 0 && after.stop !== null && (yield* stopDeskWake(row, after.stop))
  })

export const markWakeAnswered = (row: Pick<WakeRow, 'member_id' | 'sealed'>): T.Task<void, never, AppEnv> =>
  T.asUnit(
    run(sql`
      UPDATE desk_wakes SET last_status = 'online', failures = 0, retry_at = NULL
      WHERE member_id = ${row.member_id} AND sealed = ${row.sealed} AND last_status = 'sent'`),
  )

export interface WakeRow {
  readonly member_id: MemberId
  readonly credential_id: CredentialId
  readonly host: string
  readonly sealed: string
  readonly enabled: number
  readonly last_wake_at: number | null
  readonly last_status: DeskWakeStatus
  readonly failures: number
  readonly retry_at: number | null
  readonly stopped_because: DeskWakeStop | null
  readonly created_at: number
  readonly updated_at: number
}

export const wakeRowOf = (memberId: MemberId): T.Task<WakeRow | null, never, AppEnv> =>
  first<WakeRow>(sql`SELECT * FROM desk_wakes WHERE member_id = ${memberId}`)

export const numberOrNull = (value: unknown): number | null => (value === null ? null : Number(value))

const SealedTarget = S.struct({ url: S.string(), headers: S.array(DeskWakeHeader) })

const isOwnAgentCredential = (memberId: MemberId, id: CredentialId): T.Task<boolean, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const row = yield* first(sql`
      SELECT id FROM credentials
      WHERE id = ${id} AND member_id = ${memberId} AND kind = 'agent' AND revoked_at IS NULL
        AND expires_at > ${env.clock.now()}`)
    return row !== null
  })

const describe = (row: WakeRow, target: WakeTarget | null): DeskWake => ({
  host: row.host,
  headerNames: target?.headers.map((header) => header.name) ?? [],
  credentialId: row.credential_id,
  enabled: Number(row.enabled) === 1,
  lastWakeAt: numberOrNull(row.last_wake_at),
  lastStatus: row.last_status,
  failures: Number(row.failures),
  stoppedBecause: target === null ? 'unreadable' : row.stopped_because,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
})
