import type { DeskWakeStatus, DeskWakeStop } from '@homingbird/protocol'

export interface WakeFacts {
  readonly now: number
  readonly lastWakeAt: number | null
  readonly lastStatus: DeskWakeStatus
  readonly retryAt: number | null
  readonly lastUsedAt: number | null
  readonly agentOnline: boolean
  readonly waitingSince: number | null
  readonly debateDueAt: number | null
}

/** Whether the woken desk used its credential since the last wake, or failed to within ten minutes. */
export const pendingWake = (
  facts: Pick<WakeFacts, 'now' | 'lastWakeAt' | 'lastStatus' | 'lastUsedAt'>,
): 'came_online' | 'did_not_come_online' | 'waiting' | null => {
  if (facts.lastStatus !== 'sent' || facts.lastWakeAt === null) return null
  if (facts.lastUsedAt !== null && facts.lastUsedAt >= facts.lastWakeAt) return 'came_online'
  return facts.now - facts.lastWakeAt >= ONLINE_WITHIN_MS ? 'did_not_come_online' : 'waiting'
}

/** Work waits 30 s to gather what arrives with it; a room wakes before its grace drops the agent out. */
export const wakeDue = (facts: WakeFacts): { readonly work: boolean; readonly debate: boolean } => {
  const quiet =
    !facts.agentOnline &&
    (facts.lastUsedAt === null || facts.now - facts.lastUsedAt >= SILENT_MS) &&
    (facts.retryAt === null || facts.now >= facts.retryAt)
  const sinceLast = facts.lastWakeAt === null ? Number.POSITIVE_INFINITY : facts.now - facts.lastWakeAt
  return {
    work:
      quiet &&
      facts.waitingSince !== null &&
      facts.now - facts.waitingSince >= COALESCE_MS &&
      sinceLast >= WORK_SPACING_MS,
    debate:
      quiet && facts.debateDueAt !== null && facts.now >= facts.debateDueAt && sinceLast >= DEBATE_SPACING_MS,
  }
}

export const debateDueAt = (
  rooms: ReadonlyArray<{ readonly graceMinutes: number; readonly joinedAt: number }>,
  lastUsedAt: number | null,
): number | null =>
  rooms.length === 0
    ? null
    : Math.min(
        ...rooms.map((room) => (lastUsedAt ?? room.joinedAt) + room.graceMinutes * 60_000 - DEBATE_LEAD_MS),
      )

export interface WakeAfter<Status extends DeskWakeStatus = DeskWakeStatus> {
  readonly lastStatus: Status
  readonly failures: number
  readonly retryAt: number | null
  readonly stop: DeskWakeStop | null
}

/** A timeout counts as sent: every wake starts a paid session, so none is retried at once. */
export const afterAttempt = (answer: WakeAnswer, failures: number, now: number): WakeAfter<AttemptStatus> => {
  if (answer === 'timeout' || (answer.status >= 200 && answer.status < 300))
    return { lastStatus: 'sent', failures, retryAt: null, stop: null }
  if (REFUSING.includes(answer.status))
    return { lastStatus: 'refused', failures: failures + 1, retryAt: null, stop: 'refused' }
  if (answer.status === 429)
    return failed(
      'rate_limited',
      failures,
      now + retryAfterMs(answer.retryAfter, now, backoffMs(failures + 1)),
    )
  return failed('unreachable', failures, now + backoffMs(failures + 1))
}

export const afterSilence = (failures: number, now: number): WakeAfter<'not_online'> =>
  failed('not_online', failures, now + backoffMs(failures + 1))

export type AttemptStatus = 'sent' | 'refused' | 'rate_limited' | 'unreachable'

export type WakeAnswer = { readonly status: number; readonly retryAfter: string | null } | 'timeout'

const ONLINE_WITHIN_MS = 10 * 60_000
export const WAKE_PASS_MS = 15_000

const COALESCE_MS = 30_000
const SILENT_MS = 2 * 60_000
const WORK_SPACING_MS = 5 * 60_000
const DEBATE_SPACING_MS = 3 * 60_000
const DEBATE_LEAD_MS = 2 * 60_000
const STOP_AFTER_FAILURES = 5
const RETRY_AFTER_MAX_MS = 60 * 60_000

const REFUSING: ReadonlyArray<number> = [400, 401, 403, 404]

const BACKOFF_MS: ReadonlyArray<number> = [5 * 60_000, 15 * 60_000, 60 * 60_000]

const backoffMs = (failures: number): number => BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]!

const failed = <Status extends DeskWakeStatus>(
  lastStatus: Status,
  failures: number,
  retryAt: number,
): WakeAfter<Status> => ({
  lastStatus,
  failures: failures + 1,
  retryAt,
  stop: failures + 1 >= STOP_AFTER_FAILURES ? 'failures' : null,
})

/** Retry-After in seconds or as an HTTP date (RFC 9110). */
const retryAfterMs = (header: string | null, now: number, fallback: number): number => {
  const value = header?.trim() ?? ''
  const asked = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now
  return Number.isFinite(asked) && asked >= 0 ? Math.min(asked, RETRY_AFTER_MAX_MS) : fallback
}
