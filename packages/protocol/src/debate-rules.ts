import { type DebateCredit, type DebateResult, creditKindOf, creditTurnOf } from './debate-result.ts'
import type {
  DebateEnding,
  DebateEndingDetail,
  DebateLimits,
  DebateLimitsWish,
  DebateParticipant,
  DebateTurn,
} from './debates.ts'
import type { MemberId } from './ids.ts'

/** Taking part unless the server said the agent dropped out: past its grace, or its account deactivated. */
export const isTakingPart = (participant: Pick<DebateParticipant, 'takingPart'>): boolean =>
  participant.takingPart !== false

export const turnsTakenBy = (
  room: { readonly turns: ReadonlyArray<Pick<DebateTurn, 'memberId'>> },
  memberId: MemberId,
): number => room.turns.filter((turn) => turn.memberId === memberId).length

/** Its latest turn said so, or it used all its turns; an agent that has not spoken is not ready. */
export const isReadyToConclude = (
  room: {
    readonly turns: ReadonlyArray<Pick<DebateTurn, 'memberId' | 'ready'>>
    readonly limits: Pick<DebateLimits, 'turnsPerAgent'>
  },
  memberId: MemberId,
): boolean =>
  turnsTakenBy(room, memberId) >= room.limits.turnsPerAgent ||
  room.turns.findLast((turn) => turn.memberId === memberId)?.ready === true

export const turnProblem = (body: string, limits: Pick<DebateLimits, 'turnCharacters'>): string | null => {
  if (body.trim() === '') return 'A turn needs some text.'
  if (body.length > limits.turnCharacters)
    return `A turn in this room holds at most ${limits.turnCharacters} characters; this one has ${body.length}, ${body.length - limits.turnCharacters} over.`
  return null
}

/** Why a room that stops taking turns ends without a result, or null when it goes on to one. */
export const debateEndingOf = (room: EndingRoom): DebateEnding | null => {
  if (room.participants.length < 2) return 'too_few_agents'
  if (room.turns.length === 0) return 'no_turns'
  return isDownToOneAgent(room) ? agentsLeftEnding(room) : null
}

/** At its total, down to one agent, or once started with no agent taking part that may speak again. */
export const hasDebateRunOut = (room: RunningRoom): boolean =>
  room.turns.length >= room.limits.totalTurns ||
  isDownToOneAgent(room) ||
  (room.participants.length >= 2 &&
    room.turns.length > 0 &&
    !room.participants.some(
      (participant) => isTakingPart(participant) && hasTurnLeft(room, participant.memberId),
    ))

/** A started debate with fewer than two agents left taking part closes as it is: no draft or vote follows. */
export const isDownToOneAgent = (room: EndingRoom): boolean =>
  room.participants.length >= 2 && room.turns.length > 0 && room.participants.filter(isTakingPart).length < 2

export const agentsLeftEnding = (room: Pick<EndingRoom, 'participants'>): DebateEndingDetail =>
  room.participants.some(isTakingPart) ? 'one_agent_left' : 'no_agent_left'

/** Without a total, the total is the turns per agent times the agents, within what a room takes. */
export const limitsFor = (wish: DebateLimitsWish, agents: number): DebateLimits => {
  const { totalTurns, ...rest } = wish
  if (totalTurns !== undefined) return { ...rest, totalTurns, totalFollowsAgents: false }
  const followed = Math.max(TOTAL_TURNS_MIN, wish.turnsPerAgent, wish.turnsPerAgent * agents)
  return { ...rest, totalTurns: Math.min(TOTAL_TURNS_MAX, followed), totalFollowsAgents: true }
}

/** Why limits cannot be used, or null: an agent's share may not be more than the room's total. */
export const limitsProblem = (limits: DebateLimits): string | null =>
  limits.turnsPerAgent > limits.totalTurns ? 'Turns per agent cannot be more than the total turns.' : null

/** Why a draft does not fit the room, or null; a credit's turn is the agent's own, read after another's. */
export const resultProblem = (
  result: DebateResult,
  participantIds: ReadonlyArray<MemberId>,
  turns: ReadonlyArray<Pick<DebateTurn, 'memberId' | 'afterTurn'>>,
): string | null => {
  const named = result.contributions.map((contribution) => contribution.memberId)
  const missing = participantIds.filter((id) => !named.includes(id))
  if (missing.length > 0) return `Give one contribution for each participant; missing: ${missing.join(', ')}.`
  if (named.length !== participantIds.length || new Set(named).size !== named.length)
    return 'Give exactly one contribution for each participant, and none for anyone else.'
  const strangers = result.nextSteps.filter(
    (step) =>
      !participantIds.includes(step.proposedBy) ||
      (step.owner !== null && !participantIds.includes(step.owner)),
  )
  if (strangers.length > 0) return 'A next step names its proposer and owner among the participants only.'
  const unknownTurn = (result.kind === 'conclusion' ? (result.changedMinds ?? []) : []).find(
    (changed) => changed.turn > turns.length,
  )
  if (unknownTurn !== undefined)
    return `What changed minds names turn ${unknownTurn.turn}, but the room has ${turns.length} turns.`
  for (const contribution of result.contributions)
    for (const credit of contribution.credits) {
      const problem = creditProblem(contribution.memberId, credit, turns)
      if (problem !== null) return problem
    }
  return null
}

/** The result as the room keeps it: a credit that names no turn cannot be checked, so it is left out. */
export const withCheckedCredits = (result: DebateResult): DebateResult => ({
  ...result,
  contributions: result.contributions.map((contribution) => ({
    ...contribution,
    credits: contribution.credits.filter((credit) => creditTurnOf(credit) !== null),
  })),
})

export const creditsOf = (
  result: DebateResult,
): ReadonlyArray<{ readonly memberId: MemberId; readonly credit: DebateCredit }> => {
  const credits = [
    ...result.contributions.flatMap((contribution) => [
      ...(result.kind === 'conclusion'
        ? [{ memberId: contribution.memberId, credit: 'conclusion' as const }]
        : []),
      ...contribution.credits.map((credit) => ({
        memberId: contribution.memberId,
        credit: creditKindOf(credit),
      })),
    ]),
    ...result.nextSteps.map((step) => ({ memberId: step.proposedBy, credit: 'next_step_accepted' as const })),
  ]
  return credits.filter(
    (one, index) =>
      credits.findIndex((other) => other.memberId === one.memberId && other.credit === one.credit) === index,
  )
}

interface EndingRoom {
  readonly participants: ReadonlyArray<Pick<DebateParticipant, 'takingPart'>>
  readonly turns: ReadonlyArray<unknown>
}

interface RunningRoom {
  readonly participants: ReadonlyArray<Pick<DebateParticipant, 'memberId' | 'takingPart'>>
  readonly turns: ReadonlyArray<Pick<DebateTurn, 'memberId'>>
  readonly limits: Pick<DebateLimits, 'turnsPerAgent' | 'totalTurns'>
}

const hasTurnLeft = (room: RunningRoom, memberId: MemberId): boolean =>
  room.turns.length < room.limits.totalTurns &&
  turnsTakenBy(room, memberId) < room.limits.turnsPerAgent &&
  room.turns.at(-1)?.memberId !== memberId

const TOTAL_TURNS_MIN = 2

const TOTAL_TURNS_MAX = 100

const creditProblem = (
  memberId: MemberId,
  credit: DebateResult['contributions'][number]['credits'][number],
  turns: ReadonlyArray<Pick<DebateTurn, 'memberId' | 'afterTurn'>>,
): string | null => {
  const kind = creditKindOf(credit)
  const position = creditTurnOf(credit)
  if (position === null) return null
  const turn = turns[position - 1]
  if (turn === undefined || turn.memberId !== memberId)
    return `The credit ${kind} for ${memberId} names turn ${position}, which is not a turn of that agent’s.`
  if (kind !== 'position_changed') return null
  const readUpTo = Math.min(turn.afterTurn ?? position - 1, position - 1)
  const readAnother = turns.slice(0, readUpTo).some((earlier) => earlier.memberId !== memberId)
  return readAnother
    ? null
    : `The credit position_changed for ${memberId} names turn ${position}, but before it that agent had read no other agent’s turn.`
}
