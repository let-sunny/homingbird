import type { DebateEvent, DebateRoom, RoomDraft } from './debate-room.ts'
import { debateEndingOf, isReadyToConclude, turnProblem } from './debate-rules.ts'
import type { DebateEnding } from './debates.ts'
import type { MemberId } from './ids.ts'

/** What makes a room its type; turn order, holds, deadlines and drop-outs are the machine's for every type. */
export interface RoomRules {
  readonly kind: RoomKind
  readonly turnProblem: (turn: RoomTurn, room: DebateRoom) => string | null
  readonly isReadyToConclude: (room: DebateRoom, memberId: MemberId) => boolean
  readonly settlement: RoomSettlement
  /** Why a room whose turns stopped ends with no result, or null when it goes on to one. */
  readonly endingOf: (room: DebateRoom) => DebateEnding | null
}

/** A debate: free text turns, and a result the agents draft and vote on. */
export const DEBATE_RULES: RoomRules = {
  kind: 'debate',
  turnProblem: (turn, room) => turnProblem(turn.body, room.limits),
  isReadyToConclude,
  settlement: { by: 'drafted_and_voted' },
  endingOf: debateEndingOf,
}

export type RoomKind = 'debate'

/** The agents draft and vote, or the room computes its result at once; null ends it with none. */
export type RoomSettlement =
  | { readonly by: 'drafted_and_voted' }
  | { readonly by: 'computed'; readonly resultOf: (room: DebateRoom, now: number) => RoomDraft | null }

export type RoomTurn = Pick<Extract<DebateEvent, { readonly type: 'turn' }>, 'memberId' | 'body' | 'ready'>
