import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  DEFAULT_GRACE_MINUTES,
  type DeskWakeTest,
  type Member,
  type MemberId,
  NotFound,
  type StreamEvent,
  isWakingEvent,
} from '@homingbird/protocol'
import { invoke } from '../api/invoke.ts'
import type { Fetch } from '../auth/identity-provider.ts'
import { survivingPass } from '../background-pass.ts'
import { memberById } from '../domain/members.ts'
import { featureIsOn } from '../domain/settings.ts'
import type { AppEnv, Caller } from '../environment.ts'
import { transact } from '../events/events.ts'
import { sendDeskStoppedPush } from '../push/notifier.ts'
import { all } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import {
  type WakeRow,
  markWakeAnswered,
  numberOrNull,
  openWakeTarget,
  recordWakeOutcome,
  stopDeskWake,
  wakeRowOf,
} from './desk-wakes.ts'
import { sendWake } from './wake-request.ts'
import {
  type AttemptStatus,
  WAKE_PASS_MS,
  type WakeAfter,
  type WakeAnswer,
  afterAttempt,
  afterSilence,
  debateDueAt,
  pendingWake,
  wakeDue,
} from './wake-schedule.ts'

export interface DeskWaker {
  /** Told of every event a member receives; one that may mean work makes their wake a candidate. */
  readonly consider: (memberId: MemberId, event: StreamEvent) => void
  readonly run: T.Task<never, never, AppEnv>
  /** One pass of `run`, which runs it every 15 seconds; a test drives it to the end itself. */
  readonly pass: T.Task<void, never, AppEnv>
  /** Sends one wake now, as the person asked, and says how it went; it changes nothing kept. */
  readonly test: (memberId: MemberId) => T.Task<DeskWakeTest, NotFound | Conflict, AppEnv>
}

/**
 * Wakes cloud desks. Every 15 seconds each wake whose person has work waiting, no desk online and a
 * silent credential is sent once, gathering what arrived close together; a debate room the desk takes
 * part in wakes it again before its grace runs out. The candidates live in memory, so after a restart
 * every wake is a candidate once.
 */
export const makeDeskWaker = (fetch: Fetch): DeskWaker => {
  const waiting = new Map<MemberId, number>()
  let primed = false
  const pass = survivingPass(
    'desk wakes',
    T.gen(function* () {
      if (!(yield* featureIsOn('cloudDesk'))) {
        waiting.clear()
        primed = false
        return
      }
      const priming = !primed
      primed = true
      yield* wakePass(fetch, waiting, priming)
    }),
  )
  return {
    consider: (memberId, event) => {
      if (!waiting.has(memberId) && isWakingEvent(event.body, memberId)) waiting.set(memberId, event.at)
    },
    run: T.forever(WAKE_PASS_MS)(pass),
    pass,
    test: (memberId) => testWake(fetch, memberId),
  }
}

const wakePass = (
  fetch: Fetch,
  waiting: Map<MemberId, number>,
  priming: boolean,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const rows = yield* all<PassRow>(sql`
      SELECT w.*, c.last_used_at, c.revoked_at, c.expires_at, c.name AS credential_name
      FROM desk_wakes w
      LEFT JOIN credentials c ON c.id = w.credential_id AND c.member_id = w.member_id`)
    const kept = new Set(rows.map((row) => row.member_id))
    for (const memberId of [...waiting.keys()]) if (!kept.has(memberId)) waiting.delete(memberId)
    for (const row of rows) {
      if (priming && !waiting.has(row.member_id)) waiting.set(row.member_id, env.clock.now())
      yield* survivingPass('desk wake', wakeOne(fetch, row, waiting))
    }
  })

const wakeOne = (fetch: Fetch, row: PassRow, waiting: Map<MemberId, number>): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const now = env.clock.now()
    const memberId = row.member_id
    if (Number(row.enabled) !== 1 || row.stopped_because !== null) {
      waiting.delete(memberId)
      return
    }
    if (row.credential_name === null || row.revoked_at !== null || Number(row.expires_at) <= now)
      return yield* stopped(fetch, row, 'credential_gone')
    const lastUsedAt = numberOrNull(row.last_used_at)
    const lastWakeAt = numberOrNull(row.last_wake_at)
    const pending = pendingWake({ now, lastWakeAt, lastStatus: row.last_status, lastUsedAt })
    if (pending === 'waiting') return
    if (pending === 'came_online') return yield* markWakeAnswered(row)
    if (pending === 'did_not_come_online') {
      env.log.emit({ name: 'desk_wake.unanswered', attributes: { memberId, host: row.host } })
      if (!waiting.has(memberId)) waiting.set(memberId, now)
      return yield* settled(fetch, row, afterSilence(Number(row.failures), now), null)
    }
    if (env.hub.presenceOf(memberId).agentOnline) {
      waiting.delete(memberId)
      return
    }
    const due = wakeDue({
      now,
      lastWakeAt,
      lastStatus: row.last_status,
      retryAt: numberOrNull(row.retry_at),
      lastUsedAt,
      agentOnline: false,
      waitingSince: waiting.get(memberId) ?? null,
      debateDueAt: debateDueAt(yield* roomsOf(row), lastUsedAt),
    })
    if (!due.work && !due.debate) return
    const caller = yield* callerOf(row)
    const hasWork = due.work && caller !== null && (yield* isWorkWaiting(caller))
    if (due.work && !hasWork) waiting.delete(memberId)
    const isAsked = !hasWork && due.debate && caller !== null && (yield* isDebateAsking(caller))
    if (!hasWork && !isAsked) return
    const target = openWakeTarget(env.config.secretsKey, row)
    if (target === null) return yield* stopped(fetch, row, 'unreadable')
    const answer = yield* sendWake(fetch, target, env.config.publicUrl)
    const after = afterAttempt(answer, Number(row.failures), now)
    env.log.emit({
      name: 'desk_wake.fired',
      attributes: {
        memberId,
        host: row.host,
        ...answerFacts(answer, after),
        reason: hasWork ? 'work' : 'debate',
      },
    })
    if (after.lastStatus === 'sent') waiting.delete(memberId)
    yield* settled(fetch, row, after, now)
  })

const testWake = (fetch: Fetch, memberId: MemberId): T.Task<DeskWakeTest, NotFound | Conflict, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const row = yield* wakeRowOf(memberId)
    if (row === null) return yield* T.fail(NotFound({ message: 'No cloud desk wake is set up.' }))
    const target = openWakeTarget(env.config.secretsKey, row)
    if (target === null)
      return yield* T.fail(Conflict({ message: 'The saved wake can no longer be read; set it up again.' }))
    const answer = yield* sendWake(fetch, target, env.config.publicUrl)
    const facts = answerFacts(answer, afterAttempt(answer, 0, env.clock.now()))
    env.log.emit({
      name: 'desk_wake.fired',
      attributes: { memberId, host: row.host, ...facts, reason: 'test' },
    })
    return { status: facts.status, outcome: facts.outcome }
  })

/** A stop that took also tells the person on their devices, as no page may be open to show it. */
const settled = (
  fetch: Fetch,
  row: WakeRow,
  after: WakeAfter,
  wokenAt: number | null,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    if (yield* transact(recordWakeOutcome(row, after, wokenAt))) yield* told(fetch, row.member_id)
  })

const stopped = (
  fetch: Fetch,
  row: WakeRow,
  because: 'credential_gone' | 'unreadable',
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    if (yield* transact(stopDeskWake(row, because))) yield* told(fetch, row.member_id)
  })

const told = (fetch: Fetch, memberId: MemberId): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    if (yield* featureIsOn('webPush')) yield* T.asUnit(sendDeskStoppedPush(fetch, memberId))
  })

/** The bound credential as a caller, to ask what waits for it exactly as the woken desk will. */
const callerOf = (row: PassRow): T.Task<Caller | null, never, AppEnv> =>
  T.fold(
    () => null,
    (member: Member) => ({
      member,
      credential: { id: row.credential_id, kind: 'agent' as const, name: row.credential_name ?? '' },
    }),
  )(memberById(row.member_id))

const isWorkWaiting = (caller: Caller): T.Task<boolean, never, AppEnv> =>
  T.gen(function* () {
    const inbox = yield* T.result(invoke('inbox.list', { query: { fresh: '1' } }, caller))
    if (inbox._tag === 'Ok' && inbox.value.items.length > 0) return true
    const requests = yield* T.result(invoke('draftRequests.list', {}, caller))
    if (requests._tag === 'Ok' && requests.value.requests.length > 0) return true
    return yield* isDebateAsking(caller)
  })

/** A room keeps an agent from dropping out only while it still asks it for a turn or a vote. */
const isDebateAsking = (caller: Caller): T.Task<boolean, never, AppEnv> =>
  T.gen(function* () {
    const debates = yield* T.result(invoke('debates.waiting', {}, caller))
    return (
      debates._tag === 'Ok' && (debates.value.asks ?? []).length + (debates.value.ballots ?? []).length > 0
    )
  })

/** The open rooms the bound credential opted into, with their grace. */
const roomsOf = (
  row: WakeRow,
): T.Task<ReadonlyArray<{ graceMinutes: number; joinedAt: number }>, never, AppEnv> =>
  T.gen(function* () {
    if (!(yield* featureIsOn('debateRooms'))) return []
    const rooms = yield* all<{ grace_minutes: number | null; created_at: number }>(sql`
      SELECT d.grace_minutes, p.created_at FROM debate_participants p JOIN debates d ON d.id = p.debate_id
      WHERE p.credential_id = ${row.credential_id} AND d.status IN ('open', 'concluding')`)
    return rooms.map((room) => ({
      graceMinutes: Number(room.grace_minutes ?? DEFAULT_GRACE_MINUTES),
      joinedAt: Number(room.created_at),
    }))
  })

const answerFacts = (answer: WakeAnswer, after: WakeAfter<AttemptStatus>) => ({
  status: answer === 'timeout' ? 0 : answer.status,
  outcome: after.lastStatus,
  timedOut: answer === 'timeout',
})

interface PassRow extends WakeRow {
  readonly last_used_at: number | null
  readonly revoked_at: number | null
  readonly expires_at: number | null
  readonly credential_name: string | null
}
