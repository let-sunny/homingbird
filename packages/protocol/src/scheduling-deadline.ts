import type { TimeSpan } from './common-slot.ts'

/**
 * Minutes a scheduling flock collects free times from its opening: until an hour before the meeting's
 * last possible start, at most a day, at least two hours, never past that start (why: docs/guide.md).
 */
export const answersWithinMinutes = (
  meeting: { readonly minutes: number; readonly window: TimeSpan },
  now: number,
): number => {
  const untilLastStart = meeting.window.endsAt - meeting.minutes * MINUTE_MS - now
  const wanted = Math.min(ANSWERS_AT_MOST_MS, Math.max(ANSWERS_AT_LEAST_MS, untilLastStart - INVITE_TIME_MS))
  return Math.max(ANSWERS_MINUTES_MIN, Math.floor(Math.min(wanted, untilLastStart) / MINUTE_MS))
}

export const ANSWERS_MINUTES_MIN = 5

const MINUTE_MS = 60_000

const HOUR_MS = 60 * MINUTE_MS

const ANSWERS_AT_MOST_MS = 24 * HOUR_MS

const ANSWERS_AT_LEAST_MS = 2 * HOUR_MS

const INVITE_TIME_MS = HOUR_MS
