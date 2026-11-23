import { type AsRead, FREE_SLOTS_MAX, type MemberId } from '@homingbird/protocol'
import { locale, strings } from '../strings.ts'

/**
 * The card on which a person picks the times they are free, one hour at a time, in their own time zone.
 * It is there while the room collects times and the person has not got an agent to answer for them, or
 * chose to answer themself.
 */
export const schedulingSlotsModel = (input: SchedulingSlotsInput): SchedulingSlotsModel | null => {
  const { debate, viewerId, timeZone } = input
  const schedule = debate.schedule
  if (debate.status !== 'open' || schedule == null) return null
  const attendee = schedule.attendees.find((one) => one.memberId === viewerId)
  if (attendee === undefined || !(input.hasAgent === false || attendee.answer === 'choosing')) return null
  const cells = freeTimeCells(schedule.window, input.now)
  const chosen = new Set(input.chosen ?? chosenFrom(cells, ownSlots(debate, viewerId)))
  const picked = cells.filter((cell) => chosen.has(cell.startsAt))
  const slots = slotsFromCells(picked)
  const dayLabel = dayFormat(timeZone)
  const timeLabel = timeFormat(timeZone)
  return {
    title: strings.scheduling.pickTitle,
    hint: strings.scheduling.pickHint({ zone: zoneShown(timeZone) }),
    days: groupedByDay(cells, (cell) => dayLabel.format(cell.startsAt)).map(([day, dayCells]) => ({
      day,
      cells: dayCells.map((cell) => ({
        startsAt: cell.startsAt,
        label: timeLabel.format(cell.startsAt),
        chosen: chosen.has(cell.startsAt),
      })),
    })),
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
  /** Whether the viewer has an agent that can answer for them. */
  readonly hasAgent: boolean
  readonly now: number
  /** The hours picked so far, by when each starts; what the person gave before when absent. */
  readonly chosen?: Iterable<number>
  /** An IANA time zone for tests; the browser's own when absent. */
  readonly timeZone?: string
}

export interface SchedulingSlotsModel {
  readonly title: string
  readonly hint: string
  readonly days: ReadonlyArray<{
    readonly day: string
    readonly cells: ReadonlyArray<{
      readonly startsAt: number
      readonly label: string
      readonly chosen: boolean
    }>
  }>
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

const dayFormat = (timeZone: string | undefined): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(timeZone !== undefined && { timeZone }),
  })

const timeFormat = (timeZone: string | undefined): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone !== undefined && { timeZone }),
  })

const zoneShown = (timeZone: string | undefined): string =>
  timeZone ?? new Intl.DateTimeFormat(locale).resolvedOptions().timeZone
