import { Task as T, isOk } from '@homingbird/kernel'
import {
  type Attendance,
  type AttendanceEvent,
  type AttendanceState,
  type AttendanceStep,
  type CalendarReport,
  Conflict,
  type Debate,
  type DebateId,
  Forbidden,
  Invalid,
  type MeetingAsk,
  type MemberId,
  type NotFound,
  type ScheduleResult,
  askWaitingOn,
  confirmAttendance,
  stepAttendance,
} from '@homingbird/protocol'
import { type Caller, isHuman, viewerOf } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { type DebateRow, announceDebate, describeDebate, loadRoom, visibleDebate } from './debate-rows.ts'
import {
  addingsOf,
  attendanceOf,
  cancelInvite,
  keepAttendance,
  keepInvite,
  meetingAgentOf,
  meetingsWaitingOn,
} from './meeting-rows.ts'
import { lockedSchedulingRoom, requireDebateRooms } from './scheduling-rooms.ts'

/** Asks the opener for one invitation; a busy optional person is not invited, a silent required one is. */
export const confirmMeeting = (
  row: DebateRow,
  slot: Extract<ScheduleResult, { readonly kind: 'slot' }>,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const attendees = yield* all<{ member_id: MemberId }>(sql`
      SELECT a.member_id FROM scheduling_attendees a
      JOIN debate_members m ON m.debate_id = a.debate_id AND m.member_id = a.member_id
      WHERE a.debate_id = ${row.id} ORDER BY m.created_at, a.member_id`)
    const invited = attendees
      .map((attendee) => attendee.member_id)
      .filter((memberId) => !slot.optionalBusy.includes(memberId))
    const step = confirmAttendance(row.created_by, invited, yield* addingsOf(row.id))
    yield* keepAttendance(row, null, step)
  })

/** An agent's word on its own person's calendar, which moves that person's part only. */
export const reportCalendar = (
  caller: Caller,
  id: DebateId,
  report: CalendarReport,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    yield* requireDebateRooms
    yield* visibleDebate(viewerOf(caller), id)
    if (isHuman(caller))
      return yield* T.fail(
        Forbidden({
          message: 'Agents report on calendars; a person adds or takes out a meeting in the web client.',
        }),
      )
    if ((yield* meetingAgentOf(id, caller.member.id)) !== caller.credential.id)
      return yield* T.fail(Forbidden({ message: 'Your person has not opted this agent in for this room.' }))
    if (report.outcome !== 'sent' && (report.inviteUid !== undefined || report.meetingUrl !== undefined))
      return yield* T.fail(Invalid({ message: 'Only a sent invitation carries its id and meeting link.' }))
    const row = yield* lockedSchedulingRoom(id)
    yield* moveAttendance(row, { type: 'report', memberId: caller.member.id, outcome: report.outcome })
    if (report.outcome === 'sent') yield* keepInvite(id, report)
    return yield* describeDebate(row)
  })

/** A person's click: their agent adds it or sends the invitation, or they say they did it themself. */
export const addMeeting = (
  caller: Caller,
  id: DebateId,
): T.Task<Debate, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    const row = yield* attendedRoom(caller, id)
    const memberId = caller.member.id
    const moved = yield* moveAttendance(row, { type: 'add', memberId })
    const isSentByHand = memberId === row.created_by && stateOf(moved.attendance, memberId) === 'added'
    if (isSentByHand) yield* keepInvite(id, {})
    return yield* describeDebate(row)
  })

/** Takes the meeting out, or declines while it waits on them; from the opener it cancels it for everyone. */
export const takeOutMeeting = (
  caller: Caller,
  id: DebateId,
): T.Task<Debate, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    const row = yield* attendedRoom(caller, id)
    const memberId = caller.member.id
    const attendance = yield* requireAttendance(row)
    const state = stateOf(attendance, memberId)
    const isOpener = memberId === row.created_by
    const isWaitingOnPerson = state === 'waiting_invite' || state === 'asked' || state === 'by_hand'
    yield* moveAttendance(row, { type: !isOpener && isWaitingOnPerson ? 'decline' : 'remove', memberId })
    if (isOpener) yield* cancelInvite(id)
    return yield* describeDebate(row)
  })

export const meetingAsks = (caller: Caller): T.Task<MeetingAsk[], never, RequestEnv> =>
  T.gen(function* () {
    if (isHuman(caller)) return []
    const asks: MeetingAsk[] = []
    for (const row of yield* meetingsWaitingOn(caller.credential.id)) {
      const attendance = yield* attendanceOf(row)
      const ask = attendance === null ? null : askWaitingOn(attendance, row.member_id)
      if (ask !== null) asks.push({ debate: (yield* loadRoom(row)).debate, ask })
    }
    return asks
  })

const moveAttendance = (
  row: DebateRow,
  event: AttendanceEvent,
): T.Task<AttendanceStep, Conflict, RequestEnv> =>
  T.gen(function* () {
    const attendance = yield* requireAttendance(row)
    const step = stepAttendance(attendance, event, yield* addingsOf(row.id))
    if (!isOk(step)) return yield* T.fail(step.error)
    yield* keepAttendance(row, attendance, step.value)
    yield* announceDebate(row)
    return step.value
  })

const stateOf = (attendance: Attendance, memberId: MemberId): AttendanceState | undefined =>
  attendance.attendees.find((one) => one.memberId === memberId)?.state

const requireAttendance = (row: DebateRow): T.Task<Attendance, Conflict, RequestEnv> =>
  T.flatMap((attendance: Attendance | null) =>
    attendance === null
      ? T.fail(Conflict({ message: 'This room has not found a time for the meeting.' }))
      : T.succeed(attendance),
  )(attendanceOf(row))

const attendedRoom = (
  caller: Caller,
  id: DebateId,
): T.Task<DebateRow, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    yield* requireDebateRooms
    if (!isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Only a person adds or takes out their meeting.' }))
    yield* visibleDebate(viewerOf(caller), id)
    const row = yield* lockedSchedulingRoom(id)
    const asked = yield* all(
      sql`SELECT 1 AS present FROM scheduling_attendees WHERE debate_id = ${id} AND member_id = ${caller.member.id}`,
    )
    if (asked.length === 0)
      return yield* T.fail(
        Forbidden({ message: 'Only the people asked to this meeting add or take it out.' }),
      )
    return row
  })
