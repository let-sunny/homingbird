import type { DebateCredit, DebateResult } from './debate-result.ts'
import type { DebateEnding, DebateLimits, DebateParticipant, DebateStatus, DebateTurn } from './debates.ts'
import type { MemberId } from './ids.ts'

/** Why this participant's agent may not take the next turn now, or null when it may. */
export const whyNoTurn = (state: DebateState, memberId: MemberId, now: number): string | null => {
  if (state.status !== 'open' || now >= state.deadlineAt || state.turns.length >= state.limits.totalTurns)
    return 'This room takes no more turns: it asks for its result.'
  if (!state.participants.some((participant) => participant.memberId === memberId))
    return 'This agent was not opted in for this room.'
  if (state.participants.length < 2) return 'The room waits for a second agent to be opted in.'
  if (turnsTakenBy(state, memberId) >= state.limits.turnsPerAgent) return 'This agent has used all its turns.'
  if (state.turns.at(-1)?.memberId === memberId) return 'Another agent speaks next: no two turns in a row.'
  return null
}

export const mayTakeTurn = (state: DebateState, memberId: MemberId, now: number): boolean =>
  whyNoTurn(state, memberId, now) === null

export const isAtLimit = (state: DebateState, now: number): boolean =>
  now >= state.deadlineAt ||
  state.turns.length >= state.limits.totalTurns ||
  (state.participants.length >= 2 &&
    !state.participants.some((participant) => hasTurnLeft(state, participant.memberId)))

/** Why a room that stops now ends without asking for a result, or null when it asks for one. */
export const endingOf = (state: Pick<DebateState, 'participants' | 'turns'>): DebateEnding | null => {
  if (state.participants.length < 2) return 'too_few_agents'
  return state.turns.length === 0 ? 'no_turns' : null
}

export interface DebateState {
  readonly status: DebateStatus
  readonly limits: DebateLimits
  readonly deadlineAt: number
  readonly participants: ReadonlyArray<Pick<DebateParticipant, 'memberId'>>
  readonly turns: ReadonlyArray<Pick<DebateTurn, 'memberId'>>
}

export const turnsTakenBy = (state: Pick<DebateState, 'turns'>, memberId: MemberId): number =>
  state.turns.filter((turn) => turn.memberId === memberId).length

export const turnProblem = (body: string, limits: DebateLimits): string | null => {
  if (body.trim() === '') return 'A turn needs some text.'
  if (body.length > limits.turnCharacters)
    return `A turn in this room holds at most ${limits.turnCharacters} characters; this one has ${body.length}.`
  return null
}

/** Why limits cannot be used, or null: an agent's share may not be more than the room's total. */
export const limitsProblem = (limits: DebateLimits): string | null =>
  limits.turnsPerAgent > limits.totalTurns ? 'Turns per agent cannot be more than the total turns.' : null

/** Why a drafted result does not fit the room, or null: one contribution per participant, steps by participants. */
export const resultProblem = (
  result: DebateResult,
  participantIds: ReadonlyArray<MemberId>,
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
  return null
}

export const creditsOf = (
  result: DebateResult,
): ReadonlyArray<{ readonly memberId: MemberId; readonly credit: DebateCredit }> => {
  const credits = [
    ...result.contributions.flatMap((contribution) => [
      ...(result.kind === 'conclusion'
        ? [{ memberId: contribution.memberId, credit: 'conclusion' as const }]
        : []),
      ...contribution.credits.map((credit) => ({ memberId: contribution.memberId, credit })),
    ]),
    ...result.nextSteps.map((step) => ({ memberId: step.proposedBy, credit: 'next_step_accepted' as const })),
  ]
  return credits.filter(
    (one, index) =>
      credits.findIndex((other) => other.memberId === one.memberId && other.credit === one.credit) === index,
  )
}

const hasTurnLeft = (state: DebateState, memberId: MemberId): boolean =>
  state.participants.some((participant) => participant.memberId === memberId) &&
  state.turns.length < state.limits.totalTurns &&
  turnsTakenBy(state, memberId) < state.limits.turnsPerAgent &&
  state.turns.at(-1)?.memberId !== memberId
