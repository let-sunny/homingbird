import { type ScheduleLimits, type TimeSpan, allowedStretches, hasNoLimits } from '@homingbird/protocol'
import { locale, strings } from '../strings.ts'

/**
 * The days and hours a flock is limited to, read on the viewer's clock rather than the clock of whoever
 * opened it: the first allowed stretch of the window shows where the hours fall for the viewer, and the
 * days move with it. Null for a flock with no limit.
 */
export const limitsSummary = (
  schedule: ScheduleLimits & { readonly window: TimeSpan },
  viewerZone: string,
): string | null => {
  const { timeZone } = schedule
  if (timeZone === undefined || hasNoLimits(schedule)) return null
  const first = allowedStretches(
    { startsAt: schedule.window.startsAt - DAY_MS, endsAt: schedule.window.startsAt + 9 * DAY_MS },
    schedule,
  )[0]!
  const weekdays = schedule.weekdays
  const hours = schedule.hours
  const dayShift = weekdayIn(first.startsAt, viewerZone) - weekdayIn(first.startsAt, timeZone)
  const days =
    weekdays === undefined || weekdays.length === 7
      ? null
      : new Intl.ListFormat(locale, { type: 'conjunction', style: 'short' }).format(
          [...weekdays]
            .map((day) => ((((day - 1 + (hours === undefined ? 0 : dayShift)) % 7) + 7) % 7) + 1)
            .sort((a, b) => a - b)
            .map(weekdayName),
        )
  const from = hours === undefined ? null : clockText(first.startsAt, viewerZone)
  const to = hours === undefined ? null : clockText(first.endsAt, viewerZone)
  if (days !== null && from !== null && to !== null)
    return strings.scheduling.limitsSummary.both({ days, from, to })
  if (days !== null) return strings.scheduling.limitsSummary.days({ days })
  return strings.scheduling.limitsSummary.hours({ from: from!, to: to! })
}

const DAY_MS = 86_400_000

const weekdayIn = (at: number, timeZone: string): number => {
  const name = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(at)
  return WEEKDAYS_EN.indexOf(name) + 1
}

const WEEKDAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const weekdayName = (weekday: number): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
    Date.UTC(2026, 10, 22 + weekday),
  )

const clockText = (at: number, timeZone: string): string =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(at)
