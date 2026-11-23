import { type AsRead, type MemberId, isAgentIdle } from '@homingbird/protocol'
import { strings } from '../strings.ts'
import { type CalendarFile, meetingCalendarFile } from './calendar-file.ts'

/**
 * What a person can do about a settled meeting, when it can work: have their agent add it to their
 * calendar, say they added it themself, take it out, and open the meeting link. A person without an agent,
 * or whose agent could not add it, also gets the time as a calendar file, but never before the invitation
 * is sent, which would put the meeting in twice. While their agent is to add it, the person is told
 * whether their desk is running; when it is not, or the agent leaves it waiting, they may do it themself.
 * Whoever opened the room cancels the meeting for everyone by taking it out.
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
  const waitsOnAgent = state === 'adding' ? agentWaitOf(input, attendee.attendanceSince) : null
  const mayTakeOver = waitsOnAgent !== null && waitsOnAgent !== 'awake'
  const mayAdd = state === 'asked' || state === 'by_hand' || mayTakeOver
  const inCalendar = state === 'adding' || state === 'added'
  const mayLeave = inCalendar || mayAdd || (state === 'waiting_invite' && !isOpener)
  const mayGiveFile = !NO_FILE_STATES.has(state) && (state === 'by_hand' || mayTakeOver || !input.hasAgent)
  return {
    title: strings.scheduling.attendanceTitle,
    status:
      waitsOnAgent === null
        ? strings.scheduling.attendance[known(state)]
        : strings.scheduling.waitingOnAgent[isOpener ? 'opener' : 'attendee'][waitsOnAgent],
    meetingUrl: linkable(schedule.invite?.meetingUrl),
    meetingLinkLabel: strings.scheduling.meetingLink,
    actions: [
      ...(mayAdd
        ? [
            {
              name: 'add' as const,
              label: mayTakeOver
                ? isOpener
                  ? strings.scheduling.sentInviteMyself
                  : strings.scheduling.addedMeetingMyself
                : state === 'by_hand'
                  ? strings.scheduling.addedMeetingMyself
                  : strings.scheduling.addMeeting,
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
  /** Where the viewer's own desk shows as running or not, as their colleagues see it. */
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  /** When the page is read, for a calendar file's time stamp and how long the agent has left it waiting. */
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

const NO_FILE_STATES: ReadonlySet<string> = new Set(['cancelled', 'not_invited', 'waiting_invite'])

/** Whether the agent can be waited for: its desk runs and has had little time, it has had long, or no desk runs. */
const agentWaitOf = (
  input: SchedulingAttendanceInput,
  since: number | undefined,
): 'awake' | 'slow' | 'asleep' => {
  if (!isOwnAgentAwake(input)) return 'asleep'
  const waited = { agentOnline: true, since: since ?? input.debate.closedAt ?? input.now, now: input.now }
  return isAgentIdle(waited) ? 'slow' : 'awake'
}

/** Unknown counts as running, so a person is not sent to do by hand what their agent is doing. */
const isOwnAgentAwake = (input: SchedulingAttendanceInput): boolean =>
  input.directory.find((entry) => entry.member.id === input.viewerId)?.presence.agentOnline ?? true

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
