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
  const when = (startsAt: number, endsAt: number): string => rangeShown(startsAt, endsAt, timeZone)
  if (result.kind === 'slot')
    return {
      kind: 'schedule',
      outcome: 'slot',
      heading: strings.scheduling.slotHeading,
      lines: [
        when(result.startsAt, result.endsAt),
        ...sentence(result.optionalFree, 'optionalFree', named),
        ...sentence(result.optionalBusy, 'optionalBusy', named),
        ...sentence(result.unanswered, 'unanswered', named),
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
            count: result.closest.missing.length,
            when: when(result.closest.startsAt, result.closest.endsAt),
            names: named(result.closest.missing),
          }),
      ...sentence(result.unanswered, 'unanswered', named),
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

const namesOf =
  ({ nameOf, viewerId }: SchedulePeople) =>
  (ids: ReadonlyArray<MemberId>): string =>
    listOf(ids.map((id) => (id === viewerId ? strings.scheduling.you : nameOf(id))))

const sentence = (
  ids: ReadonlyArray<MemberId>,
  key: 'optionalFree' | 'optionalBusy' | 'unanswered',
  named: (ids: ReadonlyArray<MemberId>) => string,
): ReadonlyArray<string> =>
  ids.length === 0 ? [] : [strings.scheduling[key]({ count: ids.length, names: named(ids) })]
