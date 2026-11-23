import { Schema as S } from '@homingbird/kernel'
import type { TimeSpan } from './common-slot.ts'

/** Days of the week as ISO numbers: 1 is Monday, 7 is Sunday. */
export const Weekday = S.int({ min: 1, max: 7 })

export const MINUTES_PER_DAY = 1440

/** Weekdays and hours of the day, read in the opener's zone; left out, nothing is limited. */
export const scheduleLimitFields = {
  weekdays: S.optional(S.array(Weekday, { minItems: 1, maxItems: 7 })),
  hours: S.optional(
    S.struct({
      from: S.int({ min: 0, max: MINUTES_PER_DAY - 15 }),
      to: S.int({ min: 15, max: MINUTES_PER_DAY }),
    }),
  ),
  timeZone: S.optional(S.string({ minLength: 1, maxLength: 64 })),
}

export interface ScheduleLimits {
  readonly weekdays?: ReadonlyArray<number>
  readonly hours?: { readonly from: number; readonly to: number }
  readonly timeZone?: string
}

/** Why the limits cannot be kept, or null: a limit needs a real zone, quarter hours and each day once. */
export const scheduleLimitsProblem = (limits: ScheduleLimits): string | null => {
  const { weekdays, hours, timeZone } = limits
  if (weekdays === undefined && hours === undefined)
    return timeZone === undefined ? null : 'A time zone only goes with limits on days or hours.'
  if (timeZone === undefined || !isTimeZone(timeZone)) return 'Limits on days or hours need a time zone.'
  if (weekdays !== undefined && new Set(weekdays).size !== weekdays.length) return 'Name each weekday once.'
  if (hours === undefined) return null
  if (hours.from % 15 !== 0 || hours.to % 15 !== 0) return 'Hours start and end on a quarter hour.'
  return hours.to <= hours.from ? 'The hours end after they start.' : null
}

export const hasNoLimits = (limits: ScheduleLimits): boolean =>
  (limits.weekdays === undefined || limits.weekdays.length === 7) &&
  (limits.hours === undefined || (limits.hours.from === 0 && limits.hours.to === MINUTES_PER_DAY))

/** The stretches of a window the limits allow, in order: each chosen day cut to the hours by the zone's own clock. */
export const allowedStretches = (window: TimeSpan, limits: ScheduleLimits): ReadonlyArray<TimeSpan> => {
  const { timeZone } = limits
  if (timeZone === undefined || hasNoLimits(limits)) return [window]
  const weekdays = limits.weekdays ?? ALL_WEEKDAYS
  const hours = limits.hours ?? { from: 0, to: MINUTES_PER_DAY }
  const last = dateIn(timeZone, window.endsAt)
  const stretches: Array<{ startsAt: number; endsAt: number }> = []
  for (let day = dateIn(timeZone, window.startsAt); day <= last; day += DAY_MS) {
    if (!weekdays.includes(isoWeekday(day))) continue
    const startsAt = Math.max(window.startsAt, instantIn(timeZone, day, hours.from))
    const endsAt = Math.min(window.endsAt, instantIn(timeZone, day, hours.to))
    if (startsAt >= endsAt) continue
    const before = stretches.at(-1)
    if (before !== undefined && before.endsAt >= startsAt) before.endsAt = endsAt
    else stretches.push({ startsAt, endsAt })
  }
  return stretches
}

/** Whether a meeting of that many minutes fits anywhere in the window within the limits. */
export const isMeetingPossible = (window: TimeSpan, minutes: number, limits: ScheduleLimits): boolean =>
  allowedStretches(window, limits).some((stretch) => stretch.endsAt - stretch.startsAt >= minutes * 60_000)

/** Whether the whole span lies in one allowed stretch. */
export const isAllowed = (stretches: ReadonlyArray<TimeSpan>, span: TimeSpan): boolean =>
  stretches.some((stretch) => stretch.startsAt <= span.startsAt && span.endsAt <= stretch.endsAt)

/** The limits as a sentence for an agent, or null when there are none. */
export const limitsSentence = (limits: ScheduleLimits): string | null => {
  if (limits.timeZone === undefined || hasNoLimits(limits)) return null
  const days =
    limits.weekdays === undefined || limits.weekdays.length === 7
      ? null
      : `on ${[...limits.weekdays]
          .sort((a, b) => a - b)
          .map((day) => WEEKDAY_NAMES[day - 1])
          .join(', ')}`
  const hours =
    limits.hours === undefined
      ? null
      : `from ${clockText(limits.hours.from)} to ${clockText(limits.hours.to)}`
  return `The meeting must lie ${[days, hours].filter((part) => part !== null).join(', ')}, by the clock in ${limits.timeZone} (the time zone of whoever opened the flock): offer no free time outside it, and the flock cannot use one.`
}

export const limitsLines = (limits: ScheduleLimits): ReadonlyArray<string> => {
  const sentence = limitsSentence(limits)
  return sentence === null ? [] : [sentence]
}

export const clippedToLimits = (
  spans: ReadonlyArray<TimeSpan>,
  window: TimeSpan,
  limits: ScheduleLimits,
): ReadonlyArray<TimeSpan> =>
  allowedStretches(window, limits).flatMap((stretch) =>
    spans.flatMap((span) => {
      const startsAt = Math.max(span.startsAt, stretch.startsAt)
      const endsAt = Math.min(span.endsAt, stretch.endsAt)
      return startsAt < endsAt ? [{ startsAt, endsAt }] : []
    }),
  )

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const clockText = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

const DAY_MS = 86_400_000

/** The zone's calendar date at the instant, as the UTC midnight of that same date. */
const dateIn = (zone: string, at: number): number => {
  const clock = clockIn(zone, at)
  return Date.UTC(clock.year, clock.month - 1, clock.day)
}

/** The instant the zone's clock reads `minutes` into the date (a UTC midnight); a skipped time moves on. */
const instantIn = (zone: string, date: number, minutes: number): number => {
  const naive = date + minutes * 60_000
  const guess = naive - offsetIn(zone, naive)
  return naive - offsetIn(zone, guess)
}

const isoWeekday = (date: number): number => new Date(date).getUTCDay() || 7

const offsetIn = (zone: string, at: number): number => {
  const clock = clockIn(zone, at)
  const shown = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second)
  return shown - Math.floor(at / 1000) * 1000
}

const clockIn = (zone: string, at: number) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at)
  const part = (type: string) => Number(parts.find((one) => one.type === type)!.value)
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  }
}

const isTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}
