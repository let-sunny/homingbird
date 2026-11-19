import { Result } from '@homingbird/kernel'
import { DEBATE_PARTICIPANTS_MAX, type DebateCredit, type DebateResult } from './debate-result.ts'
import {
  creditsOf,
  isTakingPart,
  limitsProblem,
  resultProblem,
  turnProblem,
  turnsTakenBy,
} from './debate-rules.ts'
import type {
  DebateEnding,
  DebateEndingDetail,
  DebateLimits,
  DebateParticipant,
  DebateResultDraft,
  DebateTurn,
  DebateVote,
} from './debates.ts'
import { Conflict, Invalid } from './errors.ts'
import type { MemberId } from './ids.ts'

/** Settles what time decided, takes the event, then settles what it decided; a refusal changes nothing. */
export const stepDebate = (
  room: DebateRoom,
  event: DebateEvent,
  now: number,
): Result.Result<DebateMove, Conflict | Invalid> => {
  const before = settleDebateRoom(room, now)
  const taken = takeEvent(before.room, event, now)
  if (!Result.isOk(taken)) return taken
  const after = followUp(taken.value.room, event, now)
  return Result.ok({
    room: after.room,
    before: before.effects,
    action: taken.value.action,
    after: after.effects,
  })
}

/**
 * What time alone decides, which is never refused; settling a settled room changes nothing. A room whose
 * turns stopped never waits for an agent that dropped out; an overdue room votes no more and settles its
 * drafts at once, the most votes winning and a tie going to the earliest.
 */
export const settleDebateRoom = (room: DebateRoom, now: number): DebateSettled => {
  const stage = room.stage
  switch (stage.stage) {
    case 'setup':
    case 'open':
      if (now >= room.deadlineAt) return stop(room, 'time', now)
      return isAtLimit(room, now) ? stop(room, 'limit', now) : unchanged(room)
    case 'approving':
      return close(room, stage.result, null, stage.result.draftedAt)
    case 'drafting':
    case 'voting':
      return decide(room, stage, now)
    default:
      return unchanged(room)
  }
}

/** What the room asks of a participant's agent now: a turn, a draft of the result, a vote, or nothing. */
export const askOf = (room: DebateRoom, memberId: MemberId, now: number): DebateAskKind | null => {
  switch (room.stage.stage) {
    case 'setup':
    case 'open':
      return whyNoTurn(room, memberId, now) === null ? 'turn' : null
    case 'drafting':
      return room.drafts.some((draft) => draft.draftedBy === memberId) ? null : 'result'
    case 'voting':
      return votersOf(room).includes(memberId) && !votedBy(room).includes(memberId) ? 'ballot' : null
    default:
      return null
  }
}

/** How long a room keeps collecting drafts of its result after the first one arrives. */
export const RESULT_DRAFTING_WINDOW_MS = 3 * 60_000

export const RESULT_VOTING_WINDOW_MS = 5 * 60_000

/** How long a room waits for a settled result after its turns stopped. */
export const RESULT_WINDOW_MS = 24 * 60 * 60_000

export const ALREADY_DRAFTED = 'Your agent already drafted this round’s result.'

export const ALREADY_VOTED = 'This agent has already voted in this round.'

export interface DebateRoom {
  readonly stage: DebateStage
  readonly createdAt: number
  readonly deadlineAt: number
  readonly limits: DebateLimits
  readonly participants: ReadonlyArray<Pick<DebateParticipant, 'memberId' | 'takingPart'>>
  readonly turns: ReadonlyArray<Pick<DebateTurn, 'memberId'>>
  readonly round: number
  readonly drafts: ReadonlyArray<RoomDraft>
  readonly votes: ReadonlyArray<RoomVote>
}

/**
 * Setup lasts until the first turn; the room takes turns while open; once they stop it collects drafts,
 * then votes on them, and closes with a result or ends with the reason it has none. A room stored while
 * it waited for people's approvals is approving: it closes with the result it chose.
 */
export type DebateStage =
  | { readonly stage: 'setup' }
  | { readonly stage: 'open' }
  | { readonly stage: 'drafting'; readonly concludedAt: number }
  | { readonly stage: 'voting'; readonly concludedAt: number; readonly votesOpenAt: number }
  | { readonly stage: 'approving'; readonly concludedAt: number; readonly result: RoomDraft }
  | { readonly stage: 'closed'; readonly result: RoomDraft }
  | { readonly stage: 'ended'; readonly because: DebateEnding }

export type DebateEvent =
  | { readonly type: 'join'; readonly memberId: MemberId }
  | { readonly type: 'setLimits'; readonly limits: DebateLimits }
  | { readonly type: 'turn'; readonly memberId: MemberId; readonly body: string }
  | { readonly type: 'draft'; readonly memberId: MemberId; readonly result: DebateResult }
  | { readonly type: 'vote'; readonly memberId: MemberId; readonly vote: DebateVote }

export type DebateActionEffect =
  | { readonly type: 'addParticipant'; readonly memberId: MemberId }
  | { readonly type: 'changeLimits'; readonly limits: DebateLimits; readonly deadlineAt: number }
  | {
      readonly type: 'addTurn'
      readonly position: number
      readonly memberId: MemberId
      readonly body: string
    }
  | {
      readonly type: 'addDraft'
      readonly round: number
      readonly memberId: MemberId
      readonly result: DebateResult
    }
  | {
      readonly type: 'addVote'
      readonly round: number
      readonly voterId: MemberId
      readonly draftBy: MemberId
    }

/** Stored in order; a closing or ending that finds the room changed since it was read changes nothing. */
export type DebateSettlingEffect =
  | { readonly type: 'conclude'; readonly because: 'limit' | 'time' }
  | { readonly type: 'openVote'; readonly round: number }
  | {
      readonly type: 'close'
      readonly round: number
      readonly chosen: RoomDraft
      readonly votes: number | null
      readonly drafts: number
      readonly droppedOut: ReadonlyArray<MemberId>
      readonly credits: ReadonlyArray<{ readonly memberId: MemberId; readonly credit: DebateCredit }>
      /** When the room already held this result: when it was drafted. */
      readonly replacing: number | null
    }
  | { readonly type: 'end'; readonly because: DebateEnding; readonly during: 'turns' | 'result' }

export interface DebateSettled {
  readonly room: DebateRoom
  readonly effects: ReadonlyArray<DebateSettlingEffect>
}

export interface DebateMove {
  readonly room: DebateRoom
  readonly before: ReadonlyArray<DebateSettlingEffect>
  readonly action: DebateActionEffect
  readonly after: ReadonlyArray<DebateSettlingEffect>
}

export type DebateAskKind = 'turn' | 'result' | 'ballot'

export type RoomDraft = Pick<DebateResultDraft, 'draftedBy' | 'draftedAt' | 'result'>

export interface RoomVote {
  readonly voterId: MemberId
  readonly draftBy: MemberId
}

interface Taken {
  readonly room: DebateRoom
  readonly action: DebateActionEffect
}

type Deciding = Extract<DebateStage, { readonly stage: 'drafting' | 'voting' }>

const takeEvent = (
  room: DebateRoom,
  event: DebateEvent,
  now: number,
): Result.Result<Taken, Conflict | Invalid> => {
  switch (event.type) {
    case 'join':
      return join(room, event.memberId)
    case 'setLimits':
      return setLimits(room, event.limits)
    case 'turn':
      return takeTurn(room, event.memberId, event.body, now)
    case 'draft':
      return addDraft(room, event.memberId, event.result, now)
    case 'vote':
      return addVote(room, event.memberId, event.vote)
  }
}

const followUp = (room: DebateRoom, event: DebateEvent, now: number): DebateSettled => {
  switch (event.type) {
    case 'join':
      return unchanged(room)
    case 'setLimits':
    case 'turn':
      return isAtLimit(room, now) ? stop(room, 'limit', now) : unchanged(room)
    default:
      return settleDebateRoom(room, now)
  }
}

const join = (room: DebateRoom, memberId: MemberId): Result.Result<Taken, Conflict> => {
  if (!isTakingTurns(room)) return refuse('This room takes no more agents.')
  if (room.participants.some((participant) => participant.memberId === memberId))
    return refuse('Your agent already takes part in this room.')
  if (room.participants.length >= DEBATE_PARTICIPANTS_MAX)
    return refuse(`A room holds at most ${DEBATE_PARTICIPANTS_MAX} agents.`)
  return Result.ok({
    room: { ...room, participants: [...room.participants, { memberId }] },
    action: { type: 'addParticipant', memberId },
  })
}

const setLimits = (room: DebateRoom, wished: DebateLimits): Result.Result<Taken, Conflict | Invalid> => {
  if (room.stage.stage === 'open')
    return refuse(
      'Limits can be changed only at setup, before the first turn; this debate has started. Open a new room to use other limits.',
    )
  if (room.stage.stage !== 'setup') return refuse('This room no longer takes turns.')
  const problem = limitsProblem(wished)
  if (problem !== null) return Result.err(Invalid({ message: problem }))
  const graceMinutes = wished.graceMinutes ?? room.limits.graceMinutes
  const limits = graceMinutes === undefined ? wished : { ...wished, graceMinutes }
  const deadlineAt = room.createdAt + limits.minutes * 60_000
  return Result.ok({
    room: { ...room, limits, deadlineAt },
    action: { type: 'changeLimits', limits, deadlineAt },
  })
}

const takeTurn = (
  room: DebateRoom,
  memberId: MemberId,
  body: string,
  now: number,
): Result.Result<Taken, Conflict | Invalid> => {
  const refusal = whyNoTurn(room, memberId, now)
  if (refusal !== null) return refuse(refusal)
  const problem = turnProblem(body, room.limits)
  if (problem !== null) return Result.err(Invalid({ message: problem }))
  return Result.ok({
    room: { ...room, stage: { stage: 'open' }, turns: [...room.turns, { memberId }] },
    action: { type: 'addTurn', position: room.turns.length + 1, memberId, body },
  })
}

const addDraft = (
  room: DebateRoom,
  memberId: MemberId,
  result: DebateResult,
  now: number,
): Result.Result<Taken, Conflict | Invalid> => {
  if (room.stage.stage === 'voting')
    return refuse('The agents are voting on this round’s drafts; no more drafts are taken.')
  if (room.stage.stage !== 'drafting')
    return refuse('The result is drafted once the room’s turns have run out.')
  if (room.drafts.some((draft) => draft.draftedBy === memberId)) return refuse(ALREADY_DRAFTED)
  const problem = resultProblem(
    result,
    room.participants.map((participant) => participant.memberId),
  )
  if (problem !== null) return Result.err(Invalid({ message: problem }))
  return Result.ok({
    room: { ...room, drafts: [...room.drafts, { draftedBy: memberId, draftedAt: now, result }] },
    action: { type: 'addDraft', round: room.round, memberId, result },
  })
}

const addVote = (room: DebateRoom, voterId: MemberId, vote: DebateVote): Result.Result<Taken, Conflict> => {
  if (room.stage.stage !== 'voting') return refuse('There is no vote on drafts in this room now.')
  if (vote.round !== room.round) return refuse('That round is over. Read the room again.')
  const refusal = whyNoVote(room, voterId, vote.draftBy)
  if (refusal !== null) return refuse(refusal)
  return Result.ok({
    room: { ...room, votes: [...room.votes, { voterId, draftBy: vote.draftBy }] },
    action: { type: 'addVote', round: room.round, voterId, draftBy: vote.draftBy },
  })
}

/** Without two agents and a turn, or with fewer than two left taking part, the room ends with no result. */
const stop = (room: DebateRoom, because: 'limit' | 'time', now: number): DebateSettled => {
  const ending = endingOf(room)
  if (ending !== null)
    return {
      room: { ...room, stage: { stage: 'ended', because: ending } },
      effects: [{ type: 'end', because: ending, during: 'turns' }],
    }
  return {
    room: { ...room, stage: { stage: 'drafting', concludedAt: now } },
    effects: [{ type: 'conclude', because }],
  }
}

const decide = (room: DebateRoom, stage: Deciding, now: number): DebateSettled => {
  if (isDownToOneAgent(room)) return end(room, agentsLeftEnding(room))
  const overdue = stage.concludedAt <= now - RESULT_WINDOW_MS
  if (room.drafts.length === 0) return overdue ? end(room, 'no_result') : unchanged(room)
  if (overdue) return closeWithWinner(room)
  if (stage.stage === 'voting') {
    const everyoneVoted = votersOf(room).every((voter) => votedBy(room).includes(voter))
    return everyoneVoted || now >= stage.votesOpenAt + RESULT_VOTING_WINDOW_MS
      ? closeWithWinner(room)
      : unchanged(room)
  }
  const everyoneDrafted = room.participants
    .filter(isTakingPart)
    .every((participant) => room.drafts.some((draft) => draft.draftedBy === participant.memberId))
  const firstDraftAt = Math.min(...room.drafts.map((draft) => draft.draftedAt))
  if (!everyoneDrafted && now < firstDraftAt + RESULT_DRAFTING_WINDOW_MS) return unchanged(room)
  if (room.drafts.length === 1) return closeWithWinner(room)
  return {
    room: { ...room, stage: { stage: 'voting', concludedAt: stage.concludedAt, votesOpenAt: now } },
    effects: [{ type: 'openVote', round: room.round }],
  }
}

/** The draft with the most votes, a tie to the earliest, becomes the result. */
const closeWithWinner = (room: DebateRoom): DebateSettled => {
  const tally = (draft: RoomDraft) => room.votes.filter((vote) => vote.draftBy === draft.draftedBy).length
  const winner = [...room.drafts].sort((a, b) => tally(b) - tally(a) || a.draftedAt - b.draftedAt)[0]!
  return close(room, winner, tally(winner), null)
}

const close = (
  room: DebateRoom,
  chosen: RoomDraft,
  votes: number | null,
  replacing: number | null,
): DebateSettled => ({
  room: { ...room, stage: { stage: 'closed', result: chosen } },
  effects: [
    {
      type: 'close',
      round: room.round,
      chosen,
      votes,
      drafts: room.drafts.length,
      droppedOut: room.participants
        .filter((participant) => !isTakingPart(participant))
        .map((participant) => participant.memberId),
      credits: creditsOf(chosen.result),
      replacing,
    },
  ],
})

const end = (room: DebateRoom, because: DebateEnding): DebateSettled => ({
  room: { ...room, stage: { stage: 'ended', because } },
  effects: [{ type: 'end', because, during: 'result' }],
})

const unchanged = (room: DebateRoom): DebateSettled => ({ room, effects: [] })

const refuse = (message: string): Result.Result<never, Conflict> => Result.err(Conflict({ message }))

const isTakingTurns = (room: DebateRoom): boolean =>
  room.stage.stage === 'setup' || room.stage.stage === 'open'

const whyNoTurn = (room: DebateRoom, memberId: MemberId, now: number): string | null => {
  if (!isTakingTurns(room) || now >= room.deadlineAt || room.turns.length >= room.limits.totalTurns)
    return 'This room takes no more turns: it asks for its result.'
  if (!room.participants.some((participant) => participant.memberId === memberId))
    return 'This agent was not opted in for this room.'
  if (room.participants.length < 2) return 'The room waits for a second agent to be opted in.'
  if (turnsTakenBy(room, memberId) >= room.limits.turnsPerAgent) return 'This agent has used all its turns.'
  if (room.turns.at(-1)?.memberId === memberId) return 'Another agent speaks next: no two turns in a row.'
  return null
}

/** Whether the room stops: at its time or total, or once started when one agent is left or none may speak. */
const isAtLimit = (room: DebateRoom, now: number): boolean =>
  now >= room.deadlineAt ||
  room.turns.length >= room.limits.totalTurns ||
  isDownToOneAgent(room) ||
  (room.participants.length >= 2 &&
    room.turns.length > 0 &&
    !room.participants.some(
      (participant) => isTakingPart(participant) && hasTurnLeft(room, participant.memberId),
    ))

const hasTurnLeft = (room: DebateRoom, memberId: MemberId): boolean =>
  room.turns.length < room.limits.totalTurns &&
  turnsTakenBy(room, memberId) < room.limits.turnsPerAgent &&
  room.turns.at(-1)?.memberId !== memberId

const endingOf = (room: DebateRoom): DebateEnding | null => {
  if (room.participants.length < 2) return 'too_few_agents'
  if (room.turns.length === 0) return 'no_turns'
  return isDownToOneAgent(room) ? agentsLeftEnding(room) : null
}

/** A started debate with fewer than two agents left taking part closes as it is: no draft or vote follows. */
const isDownToOneAgent = (room: DebateRoom): boolean =>
  room.participants.length >= 2 && room.turns.length > 0 && room.participants.filter(isTakingPart).length < 2

const agentsLeftEnding = (room: DebateRoom): DebateEndingDetail =>
  room.participants.some(isTakingPart) ? 'one_agent_left' : 'no_agent_left'

const votersOf = (room: DebateRoom): MemberId[] =>
  room.participants
    .filter(
      (participant) =>
        isTakingPart(participant) && room.drafts.some((draft) => draft.draftedBy !== participant.memberId),
    )
    .map((participant) => participant.memberId)

const votedBy = (room: DebateRoom): MemberId[] => room.votes.map((vote) => vote.voterId)

const whyNoVote = (room: DebateRoom, voterId: MemberId, draftBy: MemberId): string | null => {
  const voter = room.participants.find((participant) => participant.memberId === voterId)
  if (voter === undefined) return 'This agent was not opted in for this room.'
  if (!isTakingPart(voter)) return 'This agent dropped out of the debate: only an agent taking part votes.'
  if (voterId === draftBy) return 'An agent cannot vote for its own draft.'
  if (!room.drafts.some((draft) => draft.draftedBy === draftBy)) return 'There is no such draft to vote for.'
  if (votedBy(room).includes(voterId)) return ALREADY_VOTED
  return null
}
