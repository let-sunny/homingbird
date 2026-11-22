import type { UNKNOWN } from './compatibility.ts'
import { isTakingPart, turnsTakenBy } from './debate-rules.ts'
import {
  DEFAULT_GRACE_MINUTES,
  type DebateAskedTurn,
  type DebateLimits,
  type DebateParticipant,
  type DebateTurn,
} from './debates.ts'
import type { MemberId } from './ids.ts'

/** Whose turn it is at `now`: round robin in join order after the latest speaker, passed on each wait. */
export const turnOrderAt = (room: TurnOrderFacts, now: number): DebateAskedTurn | null =>
  turnOrderAfter(room, room.turns.at(-1)?.memberId, room.askingSince, now)

export const turnOrderAfter = (
  room: TurnOrderFacts,
  after: MemberId | undefined,
  since: number,
  now: number,
): DebateAskedTurn | null => {
  const queue = turnQueueOf(room, after)
  if (queue.length === 0) return null
  const wait = turnWaitMs(room.limits)
  const passed = Math.max(0, Math.floor((now - since) / wait))
  const at = passed % queue.length
  return {
    memberId: queue[at]!,
    until: since + (passed + 1) * wait,
    next: [...queue.slice(at + 1), ...queue.slice(0, at)],
  }
}

/** A named turn as it stands at `now` if no agent spoke since, so a client need not ask again. */
export const askedTurnLater = (
  asked: DebateAskedTurn,
  limits: { readonly graceMinutes?: number | typeof UNKNOWN },
  now: number,
): DebateAskedTurn => {
  if (now < asked.until) return asked
  const wait = turnWaitMs(limits)
  const order = [asked.memberId, ...asked.next]
  const passed = Math.floor((now - asked.until) / wait) + 1
  const at = passed % order.length
  return {
    memberId: order[at]!,
    until: asked.until + passed * wait,
    next: [...order.slice(at + 1), ...order.slice(0, at)],
  }
}

/** How long an asked agent has for its turn: half the room's grace, 2.5 minutes by default. */
export const turnWaitMs = (limits: { readonly graceMinutes?: number | typeof UNKNOWN }): number =>
  ((typeof limits.graceMinutes === 'number' ? limits.graceMinutes : DEFAULT_GRACE_MINUTES) * 60_000) / 2

/** Its latest turn said it is ready and no turn since said otherwise, so the room does not ask it. */
export const isRestingReady = (
  room: { readonly turns: ReadonlyArray<Pick<DebateTurn, 'memberId' | 'ready'>> },
  memberId: MemberId,
): boolean => {
  const latest = room.turns.findLastIndex((turn) => turn.memberId === memberId)
  return latest >= 0 && room.turns.slice(latest).every((turn) => turn.ready === true)
}

export interface TurnOrderFacts {
  readonly participants: ReadonlyArray<Pick<DebateParticipant, 'memberId' | 'takingPart'>>
  readonly turns: ReadonlyArray<Pick<DebateTurn, 'memberId' | 'ready'>>
  readonly limits: Pick<DebateLimits, 'turnsPerAgent' | 'graceMinutes'>
  readonly askingSince: number
}

const turnQueueOf = (room: TurnOrderFacts, after: MemberId | undefined): ReadonlyArray<MemberId> => {
  const latest = room.turns.at(-1)?.memberId
  const start = room.participants.findIndex((participant) => participant.memberId === after) + 1
  return [...room.participants.slice(start), ...room.participants.slice(0, start)]
    .filter(
      (participant) =>
        participant.memberId !== latest &&
        isTakingPart(participant) &&
        turnsTakenBy(room, participant.memberId) < room.limits.turnsPerAgent &&
        !isRestingReady(room, participant.memberId),
    )
    .map((participant) => participant.memberId)
}
