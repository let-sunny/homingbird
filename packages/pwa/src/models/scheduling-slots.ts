import { type AsRead, FREE_SLOTS_MAX, type MemberId } from '@homingbird/protocol'
import { locale, strings } from '../strings.ts'
import { zoneShown } from './schedule-result.ts'

/**
 * The card on which a person picks the times they are free, one hour at a time, in their own time zone.
 * It is there while the room collects times and no agent of theirs takes part in the room, or they were
 * asked to choose themself.
 */
export const schedulingSlotsModel = (input: SchedulingSlotsInput): SchedulingSlotsModel | null => {
  const { debate, viewerId, timeZone } = input
  const schedule = debate.schedule
  if (debate.status !== 'open' || schedule == null) return null
  const attendee = schedule.attendees.find((one) => one.memberId === viewerId)
  const isAnsweredByAgent = debate.participants.some((participant) => participant.memberId === viewerId)
  if (attendee === undefined || (isAnsweredByAgent && attendee.answer !== 'choosing')) return null
  const cells = freeTimeCells(schedule.window, input.now)
  const dayLabel = dayFormat(timeZone)
  const timeLabel = timeFormat(timeZone)
  const hourOf = hourFormat(timeZone)
  const isWorking = (cell: FreeTime): boolean => {
    const hour = Number(hourOf.format(cell.startsAt)) % 24
    return hour >= WORKING_FROM && hour < WORKING_TO
  }
  const hasNonWorking = cells.some((cell) => !isWorking(cell))
  const showsAll = input.showAllHours === true
  const shownCells = showsAll ? cells : cells.filter(isWorking)
  const chosen = new Set(input.chosen ?? chosenFrom(cells, ownSlots(debate, viewerId)))
  const picked = cells.filter((cell) => chosen.has(cell.startsAt))
  const slots = slotsFromCells(picked)
  return {
    title: strings.scheduling.pickTitle,
    hint: strings.scheduling.pickHint({ zone: zoneShown(timeZone) }),
    workingHint:
      hasNonWorking && !showsAll
        ? strings.scheduling.pickWorkingHint({
            from: hourLabel(WORKING_FROM),
            to: hourLabel(WORKING_TO),
          })
        : null,
    hoursToggle: hasNonWorking
      ? {
          label: showsAll ? strings.scheduling.pickShowWorking : strings.scheduling.pickShowAll,
          showsAll: !showsAll,
        }
      : null,
    days: groupedByDay(shownCells, (cell) => dayLabel.format(cell.startsAt)).map(([day, dayCells]) => ({
      day,
      cells: dayCells.map((cell) => ({
        startsAt: cell.startsAt,
        label: timeLabel.format(cell.startsAt),
        chosen: chosen.has(cell.startsAt),
      })),
    })),
    chosenStarts: [...chosen],
    emptyText: cells.length === 0 ? strings.scheduling.pickNoTimes : null,
    count: strings.scheduling.pickedCount({ count: picked.length }),
    problem: slots.length > FREE_SLOTS_MAX ? strings.scheduling.pickTooMany({ max: FREE_SLOTS_MAX }) : null,
    slots,
    send: strings.scheduling.pickSend,
    sendDisabled: picked.length === 0 || slots.length > FREE_SLOTS_MAX,
    busy: strings.scheduling.pickBusy,
    busyHint: strings.scheduling.pickBusyHint,
    answered: attendee.answer === 'by_person' ? strings.scheduling.pickAnswered : null,
  }
}

export interface SchedulingSlotsInput {
  readonly debate: AsRead.Debate
  readonly viewerId: MemberId
  readonly now: number
  /** The hours picked so far, by when each starts; what the person gave before when absent. */
  readonly chosen?: Iterable<number>
  /** Every hour of the day rather than the working hours only. */
  readonly showAllHours?: boolean
  /** An IANA time zone for tests; the browser's own when absent. */
  readonly timeZone: string
}

export interface SchedulingSlotsModel {
  readonly title: string
  readonly hint: string
  /** Says that only working hours are shown, when hours are hidden. */
  readonly workingHint: string | null
  /** The button that shows all hours or the working hours only, and what showing asks for; null when every hour is working time. */
  readonly hoursToggle: { readonly label: string; readonly showsAll: boolean } | null
  readonly days: ReadonlyArray<{
    readonly day: string
    readonly cells: ReadonlyArray<{
      readonly startsAt: number
      readonly label: string
      readonly chosen: boolean
    }>
  }>
  /** Every hour ticked, hidden ones included, by when each starts. */
  readonly chosenStarts: ReadonlyArray<number>
  /** Why there is nothing to pick, when the whole window has passed. */
  readonly emptyText: string | null
  /** For example "3 hours picked". */
  readonly count: string
  readonly problem: string | null
  /** The picked hours, neighbours joined, in UTC epoch milliseconds, as they are sent. */
  readonly slots: ReadonlyArray<FreeTime>
  readonly send: string
  readonly sendDisabled: boolean
  /** Sends no time at all: the person is busy throughout the window. */
  readonly busy: string
  readonly busyHint: string
  /** Set when the person has already given times, and this is a change. */
  readonly answered: string | null
}

export interface FreeTime {
  readonly startsAt: number
  readonly endsAt: number
}

/** The hours of a window that have not passed, each as it starts, from the window's start. */
export const freeTimeCells = (window: FreeTime, now: number): ReadonlyArray<FreeTime> => {
  const cells: FreeTime[] = []
  for (let startsAt = window.startsAt; startsAt < window.endsAt; startsAt += HOUR_MS) {
    const endsAt = Math.min(startsAt + HOUR_MS, window.endsAt)
    if (endsAt > now) cells.push({ startsAt, endsAt })
  }
  return cells
}

/** The picked hours with neighbouring ones joined into one stretch, earliest first. */
export const slotsFromCells = (picked: ReadonlyArray<FreeTime>): ReadonlyArray<FreeTime> => {
  const joined: FreeTime[] = []
  for (const cell of [...picked].sort((a, b) => a.startsAt - b.startsAt)) {
    const last = joined.at(-1)
    if (last !== undefined && last.endsAt >= cell.startsAt)
      joined[joined.length - 1] = { startsAt: last.startsAt, endsAt: Math.max(last.endsAt, cell.endsAt) }
    else joined.push(cell)
  }
  return joined
}

const HOUR_MS = 3_600_000

/** The hours of the day, in the viewer's time zone, that the card shows unless asked for all of them. */
const WORKING_FROM = 8
const WORKING_TO = 20

const ownSlots = (debate: AsRead.Debate, viewerId: MemberId): ReadonlyArray<FreeTime> =>
  debate.schedule?.freeSlots?.find((given) => given.memberId === viewerId)?.slots ?? []

const chosenFrom = (cells: ReadonlyArray<FreeTime>, given: ReadonlyArray<FreeTime>): ReadonlyArray<number> =>
  cells
    .filter((cell) => given.some((slot) => slot.startsAt <= cell.startsAt && cell.endsAt <= slot.endsAt))
    .map((cell) => cell.startsAt)

const groupedByDay = <T>(cells: ReadonlyArray<T>, dayOf: (cell: T) => string): Array<[string, T[]]> => {
  const days = new Map<string, T[]>()
  for (const cell of cells) days.set(dayOf(cell), [...(days.get(dayOf(cell)) ?? []), cell])
  return [...days]
}

const dayFormat = (timeZone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  })

const timeFormat = (timeZone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  })

const hourFormat = (timeZone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone,
  })

const hourLabel = (hour: number): string =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, hour))
