import {
  DEBATE_PARTICIPANTS_MAX,
  DEBATE_QUESTION_MAX,
  type MemberId,
  SCHEDULE_WINDOW_MAX_DAYS,
  type ScheduleSetup,
  windowAheadOf,
} from '@homingbird/protocol'
import { strings } from '../strings.ts'

/**
 * What the form to open a scheduling room starts with and offers: the lengths, the days a time is
 * looked for, from today for a week, and a line for each person chosen to mark them optional.
 */
export const schedulingFormModel = (input: SchedulingFormInput): SchedulingFormModel => ({
  maxTitleLength: DEBATE_QUESTION_MAX,
  maxAttendees: DEBATE_PARTICIPANTS_MAX - 1,
  lengths: LENGTH_CHOICES.map((minutes) => ({
    value: minutes,
    label: strings.scheduling.lengthChoice({ minutes }),
    selected: minutes === DEFAULT_LENGTH,
  })),
  earliestDay: dayValue(input.now),
  latestDay: dayValue(input.now + (DEFAULT_WINDOW_DAYS - 1) * DAY_MS),
  windowHint: strings.scheduling.windowHint({ days: SCHEDULE_WINDOW_MAX_DAYS }),
  attendees: input.chosen.map((memberId) => ({
    memberId,
    name: input.nameOf(memberId),
    optional: input.optional.has(memberId),
    label: strings.scheduling.optionalFor({ name: input.nameOf(memberId) }),
  })),
})

/**
 * The setup typed into the form, or the reason it cannot be opened. The days are read in the browser's
 * time zone: the window runs from the start of the earliest day, or from now when that day has begun, to
 * the end of the latest.
 */
export const scheduleSetupFrom = (
  typed: TypedSchedule,
  now: number,
): { readonly setup: ScheduleSetup } | { readonly problem: string } => {
  const title = typed.title.trim()
  if (title === '') return { problem: strings.scheduling.problems.noTitle }
  if (typed.chosen.length === 0) return { problem: strings.scheduling.problems.noAttendee }
  const startsAt = startOfDay(typed.earliestDay)
  const lastStart = startOfDay(typed.latestDay)
  if (startsAt === null || lastStart === null) return { problem: strings.scheduling.problems.noDays }
  if (lastStart < startsAt) return { problem: strings.scheduling.problems.daysOutOfOrder }
  const endsAt = startOfDay(dayValue(lastStart + DAY_MS * 1.5))!
  if (Math.round((endsAt - startsAt) / DAY_MS) > SCHEDULE_WINDOW_MAX_DAYS)
    return { problem: strings.scheduling.problems.tooManyDays({ days: SCHEDULE_WINDOW_MAX_DAYS }) }
  if (endsAt <= now) return { problem: strings.scheduling.problems.passed }
  const minutes = lengthFrom(typed.minutes)
  const window = windowAheadOf({ startsAt, endsAt }, now)
  if (window.endsAt - window.startsAt < minutes * 60_000)
    return { problem: strings.scheduling.problems.tooLittleLeft }
  return {
    setup: {
      title,
      minutes,
      window,
      attendees: typed.chosen.map((memberId) => ({ memberId, required: !typed.optional.has(memberId) })),
    },
  }
}

/** A person marked optional, or required again. */
export const withOptional = (
  optional: ReadonlySet<MemberId>,
  memberId: MemberId,
  isOptional: boolean,
): ReadonlySet<MemberId> => {
  const next = new Set(optional)
  if (isOptional) next.add(memberId)
  else next.delete(memberId)
  return next
}

export interface SchedulingFormInput {
  readonly now: number
  readonly chosen: ReadonlyArray<MemberId>
  readonly optional: ReadonlySet<MemberId>
  readonly nameOf: (id: MemberId) => string
}

export interface TypedSchedule {
  readonly title: string
  readonly minutes: string
  readonly earliestDay: string
  readonly latestDay: string
  readonly chosen: ReadonlyArray<MemberId>
  readonly optional: ReadonlySet<MemberId>
}

export interface SchedulingFormModel {
  readonly maxTitleLength: number
  readonly maxAttendees: number
  readonly lengths: ReadonlyArray<{
    readonly value: number
    readonly label: string
    readonly selected: boolean
  }>
  readonly earliestDay: string
  readonly latestDay: string
  readonly windowHint: string
  readonly attendees: ReadonlyArray<{
    readonly memberId: MemberId
    readonly name: string
    readonly optional: boolean
    readonly label: string
  }>
}

const DAY_MS = 86_400_000

const DEFAULT_WINDOW_DAYS = 7

const DEFAULT_LENGTH = 30

const LENGTH_CHOICES = [15, 30, 45, 60, 90, 120, 180, 240] as const

const lengthFrom = (typed: string): number => {
  const minutes = Number.parseInt(typed, 10)
  return LENGTH_CHOICES.find((choice) => choice === minutes) ?? DEFAULT_LENGTH
}

/** A day as a date field holds it, in the browser's time zone. */
const dayValue = (timestamp: number): string => {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`
}

/** The start, in the browser's time zone, of a day a date field holds; null for no day. */
const startOfDay = (day: string): number | null => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return parts === null ? null : new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])).getTime()
}
