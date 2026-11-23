import type { DebateEvent, DebateRoom, RoomOutcome } from './debate-room.ts'
import { debateEndingOf, hasDebateRunOut, isReadyToConclude, turnProblem } from './debate-rules.ts'
import type { DebateEnding } from './debates.ts'
import type { MemberId } from './ids.ts'
import type { ScheduleResult } from './schedule-result.ts'
import {
  isEveryRequiredAnswered,
  scheduleEndingOf,
  scheduleOf,
  scheduleTurnProblem,
} from './scheduling-rules.ts'

/** What makes a room its type; turn order, holds, deadlines and drop-outs are the machine's for every type. */
export interface RoomRules {
  readonly kind: RoomKind
  readonly agentsToStart: number
  readonly timeFromFirstTurn: boolean
  readonly turnProblem: (turn: RoomTurn, room: DebateRoom) => string | null
  readonly mayRetry: (turn: RoomTurn) => boolean
  readonly isReadyToConclude: (room: DebateRoom, memberId: MemberId) => boolean
  readonly hasRunOut: (room: DebateRoom) => boolean
  readonly settlement: RoomSettlement
  readonly endingOf: (room: DebateRoom) => DebateEnding | null
}

/** A debate: free text turns, and a result the agents draft and vote on. */
export const DEBATE_RULES: RoomRules = {
  kind: 'debate',
  agentsToStart: 2,
  timeFromFirstTurn: true,
  turnProblem: (turn, room) => turnProblem(turn.body, room.limits),
  mayRetry: (turn) => turn.body.trim() !== '',
  isReadyToConclude,
  hasRunOut: hasDebateRunOut,
  settlement: { by: 'drafted_and_voted' },
  endingOf: debateEndingOf,
}

/** Free slots from each agent or person, and the earliest time every required person is free. */
export const SCHEDULING_RULES: RoomRules = {
  kind: 'scheduling',
  agentsToStart: 1,
  timeFromFirstTurn: false,
  turnProblem: scheduleTurnProblem,
  mayRetry: () => true,
  isReadyToConclude: isEveryRequiredAnswered,
  hasRunOut: isEveryRequiredAnswered,
  settlement: { by: 'computed', resultOf: scheduleOf },
  endingOf: scheduleEndingOf,
}

export type RoomKind = 'debate' | 'scheduling'

/** The agents draft and vote, or the room computes its result at once; null ends it with none. */
export type RoomSettlement =
  | { readonly by: 'drafted_and_voted' }
  | { readonly by: 'computed'; readonly resultOf: (room: DebateRoom, now: number) => RoomOutcome | null }

export interface ComputedResult {
  readonly draftedBy: null
  readonly draftedAt: number
  readonly result: ScheduleResult
}

export type RoomTurn = Pick<
  Extract<DebateEvent, { readonly type: 'turn' }>,
  'memberId' | 'body' | 'ready' | 'slots'
>
