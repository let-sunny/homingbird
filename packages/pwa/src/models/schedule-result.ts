import type { AsRead, MemberId } from '@homingbird/protocol'
import { listOf, locale, strings } from '../strings.ts'

/**
 * A scheduling room's result in words: the meeting time in the viewer's time zone, who is optional and
 * busy, and who did not answer; or that no time suits every required attendee, with the closest option.
 */
export const scheduleResultBody = (
  result: ScheduleKind,
  people: SchedulePeople,
  timeZone?: string,
): ScheduleResultBody => {
  const named = namesOf(people)
  const sentence = (ids: ReadonlyArray<MemberId>, key: SentenceKey): ReadonlyArray<string> =>
    ids.length === 0
      ? []
      : [strings.scheduling[key]({ count: countOf(ids, people.viewerId), names: named(ids) })]
  const when = (startsAt: number, endsAt: number): string => rangeShown(startsAt, endsAt, timeZone)
  if (result.kind === 'slot')
    return {
      kind: 'schedule',
      outcome: 'slot',
      heading: strings.scheduling.slotHeading,
      lines: [
        when(result.startsAt, result.endsAt),
        ...sentence(result.optionalFree, 'optionalFree'),
        ...sentence(result.optionalBusy, 'optionalBusy'),
        ...sentence(result.unanswered, 'unanswered'),
      ],
    }
  return {
    kind: 'schedule',
    outcome: 'no_slot',
    heading: strings.scheduling.noSlotHeading,
    lines: [
      strings.scheduling.noSlotText,
      result.closest === null
        ? strings.scheduling.nobodyFree
        : strings.scheduling.closest({
            count: countOf(result.closest.missing, people.viewerId),
            when: when(result.closest.startsAt, result.closest.endsAt),
            names: named(result.closest.missing, 'inSentence'),
          }),
      ...sentence(result.unanswered, 'unanswered'),
    ],
  }
}

/** A time span as the viewer's browser shows it: the day, the hours and the time zone. */
export const rangeShown = (startsAt: number, endsAt: number, timeZone?: string): string =>
  new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone !== undefined && { timeZone }),
  }).formatRange(new Date(startsAt), new Date(endsAt))

/** A time zone as its short name in the viewer's language, such as GMT+9, the way a result shows it. */
export const zoneShown = (timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat(locale, { timeZoneName: 'short', timeZone })
      .formatToParts(0)
      .filter((part) => part.type === 'timeZoneName')
      .map((part) => part.value)
      .join('')
  } catch {
    return timeZone
  }
}

/** The cases of a room result that are a time. */
export type ScheduleKind = Extract<AsRead.RoomResult, { kind: 'slot' | 'no_slot' }>

export interface SchedulePeople {
  readonly nameOf: (id: MemberId) => string
  readonly viewerId: MemberId
}

export interface ScheduleResultBody {
  readonly kind: 'schedule'
  readonly outcome: 'slot' | 'no_slot'
  readonly heading: string
  /** The time first, then each sentence that has something to say. */
  readonly lines: ReadonlyArray<string>
}

type SentenceKey = 'optionalFree' | 'optionalBusy' | 'unanswered'

/** The viewer comes first and is "you", capitalised only when the names start a sentence. */
const namesOf =
  ({ nameOf, viewerId }: SchedulePeople) =>
  (ids: ReadonlyArray<MemberId>, position: 'start' | 'inSentence' = 'start'): string =>
    listOf(
      [...ids]
        .sort((a, b) => Number(b === viewerId) - Number(a === viewerId))
        .map((id) =>
          id !== viewerId
            ? nameOf(id)
            : position === 'start'
              ? strings.scheduling.you
              : strings.scheduling.youInSentence,
        ),
    )

/** "You" takes the plural verb, so a viewer counts as more than one. */
const countOf = (ids: ReadonlyArray<MemberId>, viewerId: MemberId): number =>
  ids.includes(viewerId) ? Math.max(ids.length, 2) : ids.length
