import type { MemberId } from './ids.ts'
import { type ScheduleLimits, allowedStretches, isAllowed } from './schedule-limits.ts'

/** The earliest UTC quarter hour from which everyone is free for the meeting in its window, or null. */
export const earliestCommonSlot = (
  meeting: Meeting,
  people: ReadonlyArray<ReadonlyArray<TimeSpan>>,
): TimeSpan | null => {
  const free = people.map((spans) => mergedWithin(spans, meeting.window))
  return candidatesOf(meeting, free).find((span) => free.every((spans) => isWithin(spans, span))) ?? null
}

/** The earliest start that misses the fewest people, with whom it misses; null when it misses everyone. */
export const closestSlot = (
  meeting: Meeting,
  people: ReadonlyArray<{ readonly memberId: MemberId; readonly free: ReadonlyArray<TimeSpan> }>,
): (TimeSpan & { readonly missing: ReadonlyArray<MemberId> }) | null => {
  const free = people.map((person) => ({ ...person, free: mergedWithin(person.free, meeting.window) }))
  const tried = candidatesOf(
    meeting,
    free.map((person) => person.free),
  ).map((span) => ({
    ...span,
    missing: free.filter((person) => !isWithin(person.free, span)).map((person) => person.memberId),
  }))
  const best = tried.reduce<(typeof tried)[number] | null>(
    (closest, span) => (closest === null || span.missing.length < closest.missing.length ? span : closest),
    null,
  )
  return best === null || best.missing.length === people.length ? null : best
}

/** What is left of a window once the lead time has passed, rounded up to the quarter hour: nobody gets a meeting minutes from now. */
export const windowAheadOf = (window: TimeSpan, now: number): TimeSpan => ({
  startsAt: Math.max(window.startsAt, quarterHourFrom(now + MINIMUM_LEAD_MS)),
  endsAt: window.endsAt,
})

export const isFreeThrough = (free: ReadonlyArray<TimeSpan>, span: TimeSpan): boolean =>
  isWithin(mergedWithin(free, span), span)

export const QUARTER_HOUR_MS = 15 * 60_000

export const MINIMUM_LEAD_MS = 30 * 60_000

/** Half-open, in UTC epoch milliseconds. */
export interface TimeSpan {
  readonly startsAt: number
  readonly endsAt: number
}

export interface Meeting {
  readonly minutes: number
  readonly window: TimeSpan
  readonly limits?: ScheduleLimits
}

const mergedWithin = (spans: ReadonlyArray<TimeSpan>, window: TimeSpan): ReadonlyArray<TimeSpan> => {
  const clipped = spans
    .map((span) => ({
      startsAt: Math.max(span.startsAt, window.startsAt),
      endsAt: Math.min(span.endsAt, window.endsAt),
    }))
    .sort((a, b) => a.startsAt - b.startsAt)
  const merged: Array<{ startsAt: number; endsAt: number }> = []
  for (const span of clipped) {
    const last = merged.at(-1)
    if (last === undefined || span.startsAt > last.endsAt) merged.push(span)
    else last.endsAt = Math.max(last.endsAt, span.endsAt)
  }
  return merged
}

/** The earliest fitting start is the window's, a free span's or an allowed stretch's start, to a quarter hour. */
const candidatesOf = (meeting: Meeting, free: ReadonlyArray<ReadonlyArray<TimeSpan>>): TimeSpan[] => {
  const length = meeting.minutes * 60_000
  const stretches = allowedStretches(meeting.window, meeting.limits ?? {})
  const starts = [
    meeting.window.startsAt,
    ...stretches.map((stretch) => stretch.startsAt),
    ...free.flatMap((spans) => spans.map((span) => span.startsAt)),
  ]
  return [...new Set(starts.map(quarterHourFrom))]
    .sort((a, b) => a - b)
    .map((startsAt) => ({ startsAt, endsAt: startsAt + length }))
    .filter((span) => span.endsAt <= meeting.window.endsAt && isAllowed(stretches, span))
}

const quarterHourFrom = (at: number): number => Math.ceil(at / QUARTER_HOUR_MS) * QUARTER_HOUR_MS

const isWithin = (merged: ReadonlyArray<TimeSpan>, span: TimeSpan): boolean =>
  merged.some((free) => free.startsAt <= span.startsAt && span.endsAt <= free.endsAt)
