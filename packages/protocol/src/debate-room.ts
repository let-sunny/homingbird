import { Result } from '@homingbird/kernel'
import { DEBATE_PARTICIPANTS_MAX, type DebateCredit, type DebateResult } from './debate-result.ts'
import {
  creditsOf,
  isReadyToConclude,
  isTakingPart,
  limitsFor,
  limitsProblem,
  resultProblem,
  turnProblem,
  turnsTakenBy,
  withCheckedCredits,
} from './debate-rules.ts'
import type {
  DebateConclusion,
  DebateEnding,
  DebateEndingDetail,
  DebateLimits,
  DebateLimitsWish,
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
 * What time alone decides, which is never refused; settling a settled room changes nothing. A room stops
 * taking turns early once every agent taking part is ready to conclude. A room whose turns stopped never
 * waits for an agent that dropped out; an overdue room votes no more and settles its
 * drafts at once, the most votes winning and a tie going to the earliest.
 */
export const settleDebateRoom = (room: DebateRoom, now: number): DebateSettled => {
  const stage = room.stage
  switch (stage.stage) {
    case 'setup':
    case 'open':
      return now >= room.deadlineAt ? stop(room, 'time', now) : stopTakingTurns(room, now)
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

/**
 * The place a turn refused for its length or as stale keeps for one retry, or null; one hold per turn of
 * the agent's, so refusals cannot renew it.
 */
export const turnHoldOf = (
  room: DebateRoom,
  event: Extract<DebateEvent, { readonly type: 'turn' }>,
  now: number,
): TurnHold | null => {
  if (whyNoTurn(room, event.memberId, now) !== null) return null
  const tooLong = event.body.trim() !== '' && turnProblem(event.body, room.limits) !== null
  if (!tooLong && staleAfter(room, event.afterTurn) === null) return null
  const turnsTaken = turnsTakenBy(room, event.memberId)
  const held = (room.holds ?? []).some(
    (hold) => hold.memberId === event.memberId && hold.turnsTaken === turnsTaken,
  )
  return held ? null : { memberId: event.memberId, turnsTaken, until: now + TURN_HOLD_MS }
}

export const TURN_HOLD_MS = 2 * 60_000

/** Whether a refused turn was refused as stale, so the turns the agent missed are worth handing it. */
export const isStaleTurnRefusal = (refusal: { readonly _tag: string; readonly message: string }): boolean =>
  refusal._tag === 'Conflict' && refusal.message.startsWith(`${ROOM_MOVED_ON}:`)

/** How long a room keeps collecting drafts of its result after the first one arrives. */
export const RESULT_DRAFTING_WINDOW_MS = 3 * 60_000

export const RESULT_VOTING_WINDOW_MS = 5 * 60_000

/** How long a room waits for a settled result after its turns stopped. */
export const RESULT_WINDOW_MS = 24 * 60 * 60_000

export const ALREADY_DRAFTED = 'Your agent already drafted this round’s result.'

export const ALREADY_VOTED = 'This agent has already voted in this round.'

/** Until the first turn, the deadline is when the room ends if nobody spoke; that turn starts its time. */
export interface DebateRoom {
  readonly stage: DebateStage
  readonly createdAt: number
  readonly deadlineAt: number
  readonly limits: DebateLimits
  readonly participants: ReadonlyArray<Pick<DebateParticipant, 'memberId' | 'takingPart'>>
  readonly turns: ReadonlyArray<Pick<DebateTurn, 'memberId' | 'afterTurn' | 'ready'>>
  readonly round: number
  readonly drafts: ReadonlyArray<RoomDraft>
  readonly votes: ReadonlyArray<RoomVote>
  readonly holds?: ReadonlyArray<TurnHold>
}

/** An agent's place, kept until `until` for as long as it has taken `turnsTaken` turns. */
export interface TurnHold {
  readonly memberId: MemberId
  readonly turnsTaken: number
  readonly until: number
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
  | { readonly type: 'setLimits'; readonly limits: DebateLimitsWish }
  | {
      readonly type: 'turn'
      readonly memberId: MemberId
      readonly body: string
      readonly afterTurn?: number
      /** The agent is ready to conclude; a later turn without it takes that back. */
      readonly ready?: boolean
    }
  | { readonly type: 'draft'; readonly memberId: MemberId; readonly result: DebateResult }
  | { readonly type: 'vote'; readonly memberId: MemberId; readonly vote: DebateVote }

export type DebateActionEffect =
  | {
      readonly type: 'addParticipant'
      readonly memberId: MemberId
      /** The total the agents now come to, when it follows them; null when it stays. */
      readonly totalTurns: number | null
    }
  | { readonly type: 'changeLimits'; readonly limits: DebateLimits; readonly deadlineAt: number }
  | {
      readonly type: 'addTurn'
      readonly position: number
      readonly memberId: MemberId
      readonly body: string
      readonly afterTurn: number | null
      readonly ready: boolean
      /** The first turn starts the room's time: its new deadline; null for every later turn. */
      readonly deadlineAt: number | null
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
  | { readonly type: 'conclude'; readonly because: DebateStop }
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

/** Why a room stopped taking turns, as the room decides it. */
export type DebateStop = Exclude<DebateConclusion, 'unknown'>

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
      return takeTurn(room, event, now)
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
      return stopTakingTurns(room, now)
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
  const participants = [...room.participants, { memberId }]
  const follows = room.stage.stage === 'setup' && room.limits.totalFollowsAgents === true
  const { totalTurns: _, ...wish } = room.limits
  const limits = follows ? limitsFor(wish, participants.length) : room.limits
  return Result.ok({
    room: { ...room, participants, limits },
    action: { type: 'addParticipant', memberId, totalTurns: follows ? limits.totalTurns : null },
  })
}

const setLimits = (room: DebateRoom, wish: DebateLimitsWish): Result.Result<Taken, Conflict | Invalid> => {
  if (room.stage.stage === 'open')
    return refuse(
      'Limits can be changed only at setup, before the first turn; this debate has started. Open a new room to use other limits.',
    )
  if (room.stage.stage !== 'setup') return refuse('This room no longer takes turns.')
  const wished = limitsFor(wish, room.participants.length)
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
  event: Extract<DebateEvent, { readonly type: 'turn' }>,
  now: number,
): Result.Result<Taken, Conflict | Invalid> => {
  const { memberId, body } = event
  const refusal = whyNoTurn(room, memberId, now)
  if (refusal !== null) return refuse(refusal)
  const kept = keptPlace(room, event, now)
  const stale = staleAfter(room, event.afterTurn)
  if (stale !== null)
    return refuse(
      `${ROOM_MOVED_ON}: turns ${stale + 1} to ${room.turns.length} were taken after turn ${stale}, the last you read. Your turn was not saved: rewrite it in the light of the turns you missed.${kept}`,
    )
  const problem = turnProblem(body, room.limits)
  if (problem !== null) return Result.err(Invalid({ message: `${problem}${kept}` }))
  const afterTurn = event.afterTurn ?? null
  const ready = event.ready === true
  const deadlineAt = room.stage.stage === 'setup' ? now + room.limits.minutes * 60_000 : null
  return Result.ok({
    room: {
      ...room,
      stage: { stage: 'open' },
      deadlineAt: deadlineAt ?? room.deadlineAt,
      turns: [...room.turns, { memberId, afterTurn, ready }],
    },
    action: {
      type: 'addTurn',
      position: room.turns.length + 1,
      memberId,
      body,
      afterTurn,
      ready,
      deadlineAt,
    },
  })
}

const keptPlace = (
  room: DebateRoom,
  event: Extract<DebateEvent, { readonly type: 'turn' }>,
  now: number,
): string => {
  const until = turnHoldOf(room, event, now)?.until ?? liveHoldOf(room, event.memberId, now)?.until
  return until === undefined
    ? ''
    : ` Your place in the room is kept until ${new Date(until).toISOString()}: send the turn again before then.`
}

const staleAfter = (room: DebateRoom, afterTurn: number | undefined): number | null =>
  afterTurn !== undefined && afterTurn < room.turns.length ? afterTurn : null

/** A hold counts while it is not over and its agent has not taken a turn since. */
const liveHoldOf = (room: DebateRoom, memberId: MemberId, now: number): TurnHold | undefined =>
  (room.holds ?? []).find(
    (hold) =>
      hold.memberId === memberId && hold.until > now && hold.turnsTaken === turnsTakenBy(room, memberId),
  )

const keptForOthers = (room: DebateRoom, memberId: MemberId, now: number): number =>
  room.participants.filter(
    (participant) =>
      participant.memberId !== memberId &&
      isTakingPart(participant) &&
      liveHoldOf(room, participant.memberId, now) !== undefined,
  ).length

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
    room.turns,
  )
  if (problem !== null) return Result.err(Invalid({ message: problem }))
  const kept = withCheckedCredits(result)
  return Result.ok({
    room: { ...room, drafts: [...room.drafts, { draftedBy: memberId, draftedAt: now, result: kept }] },
    action: { type: 'addDraft', round: room.round, memberId, result: kept },
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

/** A room taking turns stops at its total, or early once every agent taking part agrees to conclude. */
const stopTakingTurns = (room: DebateRoom, now: number): DebateSettled => {
  if (isAtLimit(room, now)) return stop(room, 'limit', now)
  return isAgreed(room) ? stop(room, 'agreed', now) : unchanged(room)
}

/** Without two agents and a turn, or with fewer than two left taking part, the room ends with no result. */
const stop = (room: DebateRoom, because: DebateStop, now: number): DebateSettled => {
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

const KEPT_FOR_OTHERS =
  'The room’s last turns are kept, for two minutes at most, for agents rewriting a turn the room refused. Try again then.'

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
  if (
    liveHoldOf(room, memberId, now) === undefined &&
    room.turns.length + keptForOthers(room, memberId, now) >= room.limits.totalTurns
  )
    return KEPT_FOR_OTHERS
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

/** Once started, every agent taking part is ready to conclude: one whose latest turn does not say so dissents. */
const isAgreed = (room: DebateRoom): boolean =>
  room.turns.length > 0 &&
  room.participants.filter(isTakingPart).every((participant) => isReadyToConclude(room, participant.memberId))

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

const ROOM_MOVED_ON = 'The room moved on'
