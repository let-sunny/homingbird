import {
  ATTENDANCE_STATES,
  type Adding,
  type AttendanceEvent,
  type AttendanceState,
  type AttendanceStep,
  type Conflict,
  type Debate,
  type MemberId,
  confirmAttendance,
  stepAttendance,
} from '@homingbird/protocol'
import { changeRoom, roomById } from './debate-script.ts'
import type { World } from './world.ts'

/**
 * After a room settles, the agents do the rest as the desk does: the opener's agent sends one invitation,
 * and a moment later each colleague's agent accepts it. A person without an agent, or who asked to click
 * first, is left to do their own part. Each step looks at the room again when it comes, so asking twice
 * does nothing twice.
 */
export const agentsContinue = (world: World, debateId: string, adding: () => Adding): void => {
  const debate = roomById(world, debateId)
  if (debate === null) return
  for (const [index, attendee] of debate.schedule!.attendees.entries()) {
    const state = known(attendee.attendance)
    const report = reportFor(state, attendee.memberId === debate.createdBy)
    if (state !== null && report !== null)
      world.after(report.afterMs + (report.outcome === 'accepted' ? index * ACCEPT_GAP_MS : 0), () =>
        reportBy(world, debateId, attendee.memberId, state, report.outcome, adding),
      )
  }
}

/** A click or a report moves one person's part of the meeting, and what follows from it moves the others'. */
export const stepRoomAttendance = (
  world: World,
  debate: Debate,
  event: AttendanceEvent,
  adding: () => Adding,
): AttendanceStep | AttendanceRefusal => {
  const step = stepAttendance(
    {
      openedBy: debate.createdBy,
      attendees: debate.schedule!.attendees.flatMap((attendee) => {
        const state = known(attendee.attendance)
        return state === null ? [] : [{ memberId: attendee.memberId, state }]
      }),
    },
    event,
    (memberId) => addingOf(debate, memberId, adding),
  )
  if (step._tag === 'Err') return { refusal: step.error }
  const now = world.clock.now()
  changeRoom(world, debate.id, (current) => ({
    ...current,
    schedule: {
      ...current.schedule!,
      attendees: current.schedule!.attendees.map((attendee) => {
        const moved = step.value.attendance.attendees.find((one) => one.memberId === attendee.memberId)
        return moved === undefined || moved.state === attendee.attendance
          ? attendee
          : { ...attendee, attendance: moved.state, attendanceSince: now }
      }),
    },
  }))
  return step.value
}

/** Everyone's part of a meeting the room just confirmed: the opener is asked for the invitation first. */
export const confirmedAttendance = (
  debate: Debate,
  notInvited: ReadonlyArray<MemberId>,
  adding: () => Adding,
  now: number,
): NonNullable<Debate['schedule']>['attendees'] => {
  const attendees = debate.schedule!.attendees
  const step = confirmAttendance(
    debate.createdBy,
    attendees
      .filter((attendee) => attendee.required || !notInvited.includes(attendee.memberId))
      .map((attendee) => attendee.memberId),
    (memberId) => addingOf(debate, memberId, adding),
    notInvited,
  )
  return attendees.map((attendee) => {
    const state = step.attendance.attendees.find((one) => one.memberId === attendee.memberId)?.state
    return state === undefined ? attendee : { ...attendee, attendance: state, attendanceSince: now }
  })
}

export interface AttendanceRefusal {
  readonly refusal: Conflict
}

/** How long the opener's agent takes to send the invitation, and each colleague's to accept it after it. */
export const INVITE_AFTER_MS = 3_000
export const ACCEPT_AFTER_MS = 2_000
export const ACCEPT_GAP_MS = 1_500
export const TAKE_OUT_AFTER_MS = 2_000

type Report = 'sent' | 'accepted' | 'cancelled' | 'declined'

/** What an agent does in the calendar for a part that waits on it, and how soon. */
const reportFor = (
  state: AttendanceState | null,
  isOpener: boolean,
): { readonly outcome: Report; readonly afterMs: number } | null => {
  if (state === 'adding')
    return isOpener
      ? { outcome: 'sent', afterMs: INVITE_AFTER_MS }
      : { outcome: 'accepted', afterMs: ACCEPT_AFTER_MS }
  if (state === 'removing')
    return { outcome: isOpener ? 'cancelled' : 'declined', afterMs: TAKE_OUT_AFTER_MS }
  return null
}

const reportBy = (
  world: World,
  debateId: string,
  memberId: MemberId,
  waiting: AttendanceState,
  outcome: Report,
  adding: () => Adding,
): void => {
  const debate = roomById(world, debateId)
  if (debate === null || stateOf(debate, memberId) !== waiting) return
  const step = stepRoomAttendance(world, debate, { type: 'report', memberId, outcome }, adding)
  if ('refusal' in step) return
  if (outcome === 'sent') {
    changeRoom(world, debateId, (current) => ({
      ...current,
      schedule: {
        ...current.schedule!,
        invite: { uid: `${debateId}@demo.homingbird`, meetingUrl: `https://meet.example.com/${debateId}` },
      },
    }))
    agentsContinue(world, debateId, adding)
  }
}

/** The opener's own agent adds as their delegation allows; every colleague's agent adds at once. */
const addingOf = (debate: Debate, memberId: MemberId, adding: () => Adding): Adding =>
  memberId === debate.createdBy ? adding() : 'agent'

const stateOf = (debate: Debate, memberId: MemberId): AttendanceState | null =>
  known(debate.schedule?.attendees.find((attendee) => attendee.memberId === memberId)?.attendance)

const known = (attendance: string | undefined): AttendanceState | null =>
  ATTENDANCE_STATES.find((state) => state === attendance) ?? null
