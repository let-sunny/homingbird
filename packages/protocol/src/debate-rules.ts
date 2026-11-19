import type { DebateCredit, DebateResult } from './debate-result.ts'
import type { DebateLimits, DebateParticipant, DebateTurn } from './debates.ts'
import type { MemberId } from './ids.ts'

/** Taking part unless the server said the agent dropped out: past its grace, or its account deactivated. */
export const isTakingPart = (participant: Pick<DebateParticipant, 'takingPart'>): boolean =>
  participant.takingPart !== false

export const turnsTakenBy = (
  room: { readonly turns: ReadonlyArray<Pick<DebateTurn, 'memberId'>> },
  memberId: MemberId,
): number => room.turns.filter((turn) => turn.memberId === memberId).length

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
