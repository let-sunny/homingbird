import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { MemberId, Timestamp } from './ids.ts'

/** What an agent did in its person's calendar, never what is in it: no title, place or token decodes. */
export const CalendarReport = S.closed(
  S.struct({
    outcome: S.literal('sent', 'accepted', 'declined', 'cancelled', 'conflict', 'failed'),
    inviteUid: S.optional(InviteUid()),
    meetingUrl: S.optional(MeetingUrl()),
  }),
)
export type CalendarReport = S.Infer<typeof CalendarReport>

export type CalendarOutcome = CalendarReport['outcome']

export const MeetingInvite = S.struct({ uid: S.nullable(InviteUid()), meetingUrl: S.nullable(MeetingUrl()) })
export type MeetingInvite = S.Infer<typeof MeetingInvite>

export const ATTENDANCE_STATES = [
  'waiting_invite',
  'asked',
  'by_hand',
  'adding',
  'added',
  'declined',
  'removing',
  'removed',
  'cancelled',
  'not_invited',
] as const

/** One person's part of the meeting, as clients read it: an unknown state is not in their calendar. */
export const MeetingAttendance = S.tolerant(S.literal(...ATTENDANCE_STATES), UNKNOWN)
export type MeetingAttendance = S.Infer<typeof MeetingAttendance>

export const MeetingNoticeShown = S.struct({
  notice: S.tolerant(
    S.literal('waits', 'added', 'cancelled', 'remove_by_hand', 'busy', 'left', 'joined'),
    UNKNOWN,
  ),
  memberId: S.nullable(MemberId),
  because: S.nullable(S.tolerant(S.literal('took_out', 'declined'), UNKNOWN)),
  agentName: S.nullable(S.string({ maxLength: 200 })),
  at: Timestamp,
})
export type MeetingNoticeShown = S.Infer<typeof MeetingNoticeShown>

export const MEETING_NOTICES_SHOWN_MAX = 20

/** An iCalendar UID as calendars write one: printable, without spaces. */
function InviteUid() {
  return S.string({ minLength: 1, maxLength: 255, pattern: /^[\x21-\x7e]+$/ })
}

/** Only an http or https address, which the web client shows as a link. */
function MeetingUrl() {
  return S.string({ maxLength: 2000, pattern: /^https?:\/\/[^\s/?#]+[^\s]*$/i })
}
