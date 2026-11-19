import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type Debate,
  type DebateId,
  Forbidden,
  Invalid,
  type NotFound,
  endingOf,
  isAtLimit,
  turnProblem,
  whyNoTurn,
} from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { recordAudit } from './audit.ts'
import {
  type DebateRow,
  announceDebate,
  describeDebate,
  lockedDebate,
  participantByAgent,
  visibleDebate,
} from './debate-rows.ts'

/** Only the credential its person opted in may take a turn; a reached limit stops the room at once. */
export const takeTurn = (
  caller: Caller,
  id: DebateId,
  body: string,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const now = env.clock.now()
    yield* visibleDebate(caller.member.id, id)
    if (isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Turns are taken by agents; a person opts their agent in.' }))
    const participant = yield* participantByAgent(id, caller.credential.id)
    if (participant === null)
      return yield* T.fail(Forbidden({ message: 'Your person has not opted this agent in for this room.' }))
    const row = yield* lockedDebate(id, now)
    const before = yield* describeDebate(row)
    const refusal = whyNoTurn(before, participant.member_id, now)
    if (refusal !== null) return yield* T.fail(Conflict({ message: refusal }))
    const problem = turnProblem(body, before.limits)
    if (problem !== null) return yield* T.fail(Invalid({ message: problem }))
    yield* run(
      insertInto('debate_turns', {
        debate_id: id,
        position: before.turns.length + 1,
        member_id: participant.member_id,
        credential_id: caller.credential.id,
        agent_name: participant.agent_name,
        body,
        created_at: now,
      }),
    )
    const after = yield* describeDebate(row)
    if (isAtLimit(after, now)) return yield* conclude(row, 'limit')
    yield* announceDebate(row)
    return after
  })

export const concludeOverdueDebates: T.Task<void, never, RequestEnv> = T.gen(function* () {
  const env = yield* T.ask<RequestEnv>()
  const overdue = yield* all<DebateRow>(
    sql`SELECT * FROM debates WHERE status = 'open' AND deadline_at <= ${env.clock.now()} ORDER BY deadline_at`,
  )
  for (const row of overdue) yield* conclude(row, 'time')
  const unresolved = yield* all<DebateRow>(sql`
    SELECT * FROM debates WHERE status = 'concluding' AND concluded_at <= ${env.clock.now() - RESULT_WINDOW_MS}
    ORDER BY concluded_at`)
  for (const row of unresolved) yield* endUnresolved(row)
})

/** How long a room waits for an approved result after its turns stopped, before it ends without one. */
export const RESULT_WINDOW_MS = 24 * 60 * 60_000

const endUnresolved = (row: DebateRow): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const now = env.clock.now()
    const changed = yield* run(sql`
      UPDATE debates SET status = 'ended', ended_because = 'no_result', closed_at = ${now}, updated_at = ${now}
      WHERE id = ${row.id} AND status = 'concluding'`)
    if (changed !== 1) return
    yield* recordAudit({
      caller: null,
      action: 'debates.ended',
      target: row.id,
      detail: { because: 'no_result' },
    })
    yield* announceDebate(row, 'everyone')
  })

/** Without two agents and a turn the room ends with no result; only a call that changed it records it. */
export const conclude = (row: DebateRow, because: 'limit' | 'time'): T.Task<Debate, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const now = env.clock.now()
    const ending = endingOf(yield* describeDebate(row))
    const changed = yield* run(
      ending === null
        ? sql`UPDATE debates SET status = 'concluding', concluded_at = ${now}, updated_at = ${now}
            WHERE id = ${row.id} AND status = 'open'`
        : sql`UPDATE debates SET status = 'ended', ended_because = ${ending}, concluded_at = ${now},
            closed_at = ${now}, updated_at = ${now} WHERE id = ${row.id} AND status = 'open'`,
    )
    if (changed === 1) {
      yield* recordAudit({
        caller: null,
        action: ending === null ? 'debates.concluded' : 'debates.ended',
        target: row.id,
        detail: ending === null ? { because } : { because: ending },
      })
      yield* announceDebate(row, ending === null ? 'members' : 'everyone')
    }
    return yield* describeDebate(yield* lockedDebate(row.id, now))
  })
