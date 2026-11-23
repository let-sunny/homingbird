import type { AsRead, MemberId } from '@homingbird/protocol'
import { strings } from '../strings.ts'
import { type CalendarFile, meetingCalendarFile } from './calendar-file.ts'

/**
 * What a person can do about a settled meeting, when it can work: have their agent add it to their
 * calendar, say they added it themself, take it out, and open the meeting link. A person without an agent,
 * or whose agent could not add it, also gets the time as a calendar file. Whoever opened the room cancels the meeting for everyone by taking it out.
 */
export const schedulingAttendanceModel = (
  input: SchedulingAttendanceInput,
): SchedulingAttendanceModel | null => {
  const { debate, viewerId } = input
  const schedule = debate.schedule
  const settled = debate.result?.result
  if (debate.status !== 'closed' || schedule == null || settled?.kind !== 'slot') return null
  const attendee = schedule.attendees.find((one) => one.memberId === viewerId)
  if (attendee === undefined) return null
  const state = attendee.attendance ?? 'unknown'
  const isOpener = debate.createdBy === viewerId
  const mayAdd = state === 'asked' || state === 'by_hand'
  const inCalendar = state === 'adding' || state === 'added'
  const mayLeave = inCalendar || mayAdd || (state === 'waiting_invite' && !isOpener)
  const mayGiveFile = state !== 'cancelled' && (state === 'by_hand' || !input.hasAgent)
  return {
    title: strings.scheduling.attendanceTitle,
    status: strings.scheduling.attendance[known(state)],
    meetingUrl: linkable(schedule.invite?.meetingUrl),
    meetingLinkLabel: strings.scheduling.meetingLink,
    actions: [
      ...(mayAdd
        ? [
            {
              name: 'add' as const,
              label:
                state === 'by_hand' ? strings.scheduling.addedMeetingMyself : strings.scheduling.addMeeting,
              emphasis: 'primary' as const,
            },
          ]
        : []),
      ...(mayLeave
        ? [
            {
              name: 'remove' as const,
              label: removeLabel({ isOpener, inCalendar }),
              emphasis: 'plain' as const,
            },
          ]
        : []),
    ],
    removeHint: isOpener && mayLeave ? strings.scheduling.removeCancelsForEveryone : null,
    calendarFileLabel: strings.scheduling.getCalendarFile,
    calendarFile: mayGiveFile ? calendarFileOf(input, settled, schedule) : null,
    delegation: input.hasAgent
      ? { text: strings.scheduling.delegationNote, changeLabel: strings.scheduling.delegationChange }
      : null,
  }
}

export interface SchedulingAttendanceInput {
  readonly debate: AsRead.Debate
  readonly viewerId: MemberId
  readonly hasAgent: boolean
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  /** When the page is read, for a calendar file's time stamp. */
  readonly now: number
}

export interface SchedulingAttendanceModel {
  readonly title: string
  readonly status: string
  /** An http or https address the viewer was invited with, or null. */
  readonly meetingUrl: string | null
  readonly meetingLinkLabel: string
  readonly actions: ReadonlyArray<{
    readonly name: 'add' | 'remove'
    readonly label: string
    readonly emphasis: 'primary' | 'plain'
  }>
  /** Said beside the button that takes the meeting out, for the person who opened the room. */
  readonly removeHint: string | null
  readonly calendarFileLabel: string
  /** The time as a calendar file for a person without an agent; null when there is none to give. */
  readonly calendarFile: CalendarFile | null
  /** Tells a person with an agent that it adds meetings for them, and where to change that; null without an agent. */
  readonly delegation: { readonly text: string; readonly changeLabel: string } | null
}

const known = (state: string): keyof typeof strings.scheduling.attendance =>
  state in strings.scheduling.attendance ? (state as keyof typeof strings.scheduling.attendance) : 'unknown'

const removeLabel = (viewer: { readonly isOpener: boolean; readonly inCalendar: boolean }): string =>
  viewer.isOpener
    ? strings.scheduling.cancelMeeting
    : viewer.inCalendar
      ? strings.scheduling.removeMeeting
      : strings.scheduling.cannotCome

const linkable = (address: string | null | undefined): string | null =>
  address != null && /^https?:\/\//i.test(address) ? address : null

const calendarFileOf = (
  input: SchedulingAttendanceInput,
  slot: { readonly startsAt: number; readonly endsAt: number },
  schedule: RoomSchedule,
): CalendarFile | null => {
  const organizer = input.members.get(input.debate.createdBy)
  if (organizer === undefined) return null
  return meetingCalendarFile({
    uid: schedule.invite?.uid ?? `${input.debate.id}@homingbird`,
    title: input.debate.question,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    stampedAt: input.now,
    organizer: { name: organizer.name, email: organizer.email },
    attendees: schedule.attendees.flatMap((attendee) => {
      const person = input.members.get(attendee.memberId)
      return person === undefined ? [] : [{ name: person.name, email: person.email }]
    }),
    meetingUrl: linkable(schedule.invite?.meetingUrl),
  })
}

type RoomSchedule = NonNullable<AsRead.Debate['schedule']>
