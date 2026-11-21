import type { Unavailability } from './agent-availability.ts'

/** Whether the desk may run its agent on a waiting note now, or leaves the note delivered. */
export const mayTryNow = (state: DeskAvailability | null, now: number): boolean =>
  state === null || (state.until !== null ? now >= state.until : now - state.triedAt >= RETRY_UNAVAILABLE_MS)

/** Whether the time the agent said it could answer again has come, so the desk tries once without a note arriving. */
export const isRetryDue = (state: DeskAvailability | null, now: number): boolean =>
  state !== null && state.until !== null && now >= state.until

/**
 * The desk's state after a failed run: what the agent program said when it said why, the same kind
 * again while it already cannot answer, or "failing" once several runs failed in a row.
 */
export const unavailableAfterFailure = (
  state: DeskAvailability | null,
  recognized: Unavailability | null,
  failuresInRow: number,
  now: number,
): DeskAvailability | null => {
  if (recognized !== null) return { ...recognized, triedAt: now }
  if (state !== null) return { kind: state.kind, until: null, triedAt: now }
  return failuresInRow >= FAILURES_BEFORE_UNABLE ? { kind: 'failed', until: null, triedAt: now } : null
}

/** Whether colleagues need to hear of a new state: it started, or its kind or time changed. */
export const isNewlyUnavailable = (before: DeskAvailability | null, after: DeskAvailability): boolean =>
  before === null || before.kind !== after.kind || before.until !== after.until

/** The one line the desk prints when its agent stops being able to answer. */
export const unavailableLine = (state: DeskAvailability, timeOf: (timestamp: number) => string): string => {
  const why = WHY[state.kind]
  const next =
    state.until === null
      ? `the desk tries again on the next note, at most every ${RETRY_UNAVAILABLE_MS / 60_000} minutes`
      : `the desk tries again at ${timeOf(state.until)}`
  return `${why} Arriving notes wait as delivered and colleagues see that your agent can’t answer right now; ${next}.`
}

export interface DeskAvailability extends Unavailability {
  readonly triedAt: number
}

export const FAILURES_BEFORE_UNABLE = 3

export const RETRY_UNAVAILABLE_MS = 15 * 60_000

export const ANSWERS_AGAIN = 'The agent answers again: arriving notes are drafted as before.'

const WHY: Readonly<Record<Unavailability['kind'], string>> = {
  usage_limit: 'The agent reached its usage limit.',
  signed_out: 'The agent is signed out: sign it in again on this computer.',
  failed: `The agent command failed ${FAILURES_BEFORE_UNABLE} times in a row: it seems unable to answer, perhaps out of usage or signed out.`,
}
