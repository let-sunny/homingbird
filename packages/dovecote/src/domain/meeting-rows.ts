import { Task as T } from '@homingbird/kernel'
import {
  type Adding,
  type Attendance,
  type AttendanceNotice,
  type AttendanceState,
  type AttendanceStep,
  type CredentialId,
  type DebateId,
  type MemberId,
  mayAddByDelegation,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { list, sql } from '../sql/query.ts'
import { recordAudit } from './audit.ts'
import type { DebateRow } from './debate-rows.ts'
import { delegationOf } from './scheduling-delegations.ts'

/** The meeting's attendance as stored, opener first, or null before the room found a time. */
export const attendanceOf = (
  row: Pick<DebateRow, 'id' | 'created_by'>,
): T.Task<Attendance | null, never, AppEnv> =>
  T.map((attendees: ReadonlyArray<{ member_id: MemberId; state: AttendanceState }>): Attendance | null =>
    attendees.length === 0
      ? null
      : {
          openedBy: row.created_by,
          attendees: attendees.map((one) => ({ memberId: one.member_id, state: one.state })),
        },
  )(
    all<{ member_id: MemberId; state: AttendanceState }>(sql`
      SELECT a.member_id, a.state FROM scheduling_attendees a
      JOIN debate_members m ON m.debate_id = a.debate_id AND m.member_id = a.member_id
      WHERE a.debate_id = ${row.id} AND a.state IS NOT NULL ORDER BY m.created_at, a.member_id`),
  )

/**
 * The agent that shared free slots adds the meeting at once where its person's delegation covers it, else
 * after their click; anyone without one adds it by hand.
 */
export const addingsOf = (id: DebateId): T.Task<(memberId: MemberId) => Adding, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const agents = yield* all<{ member_id: MemberId }>(sql`
      SELECT p.member_id FROM debate_participants p
      JOIN credentials c ON c.id = p.credential_id
      WHERE p.debate_id = ${id} AND c.revoked_at IS NULL AND c.expires_at > ${env.clock.now()}
      AND EXISTS (SELECT 1 FROM debate_turns t WHERE t.debate_id = p.debate_id AND t.member_id = p.member_id)`)
    const meeting = (yield* first<{ created_by: MemberId; minutes: number; slot_starts_at: number }>(sql`
      SELECT d.created_by, s.minutes, s.slot_starts_at FROM debates d
      JOIN scheduling_rooms s ON s.debate_id = d.id WHERE d.id = ${id}`))!
    const delegated = new Set<MemberId>()
    for (const { member_id: memberId } of agents) {
      const isCovered = mayAddByDelegation(yield* delegationOf(memberId), {
        memberId,
        openedBy: meeting.created_by,
        minutes: Number(meeting.minutes),
        startsAt: Number(meeting.slot_starts_at),
      })
      if (isCovered) delegated.add(memberId)
    }
    const withAgent = new Set(agents.map((agent) => agent.member_id))
    return (memberId) =>
      delegated.has(memberId) ? 'agent' : withAgent.has(memberId) ? 'agent_after_click' : 'person'
  })

export const meetingAgentOf = (
  id: DebateId,
  memberId: MemberId,
): T.Task<CredentialId | null, never, AppEnv> =>
  T.map((found: { credential_id: CredentialId } | null) => found?.credential_id ?? null)(
    first<{ credential_id: CredentialId }>(
      sql`SELECT credential_id FROM debate_participants WHERE debate_id = ${id} AND member_id = ${memberId}`,
    ),
  )

export const meetingsWaitingOn = (
  credentialId: CredentialId,
): T.Task<ReadonlyArray<DebateRow & { member_id: MemberId }>, never, AppEnv> =>
  all<DebateRow & { member_id: MemberId }>(sql`
    SELECT d.*, p.member_id FROM debates d
    JOIN debate_participants p ON p.debate_id = d.id
    JOIN scheduling_attendees a ON a.debate_id = d.id AND a.member_id = p.member_id
    WHERE p.credential_id = ${credentialId} AND d.status = 'closed'
    AND a.state IN ${list(['adding', 'removing'])}
    ORDER BY d.created_at, d.id`)

/** Stores each part the step moved and queues its notices for after the commit. */
export const keepAttendance = (
  row: Pick<DebateRow, 'id' | 'question' | 'created_by'>,
  before: Attendance | null,
  step: AttendanceStep,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const now = env.clock.now()
    for (const attendee of step.attendance.attendees) {
      const was = before?.attendees.find((one) => one.memberId === attendee.memberId)?.state
      if (was === attendee.state) continue
      yield* run(sql`
        UPDATE scheduling_attendees SET state = ${attendee.state}, changed_at = ${now}
        WHERE debate_id = ${row.id} AND member_id = ${attendee.memberId}`)
      const isAddedWithoutAsking =
        (was === undefined || was === 'waiting_invite') && attendee.state === 'adding'
      if (isAddedWithoutAsking)
        yield* recordAudit('scheduling.meeting_added', {
          actorId: attendee.memberId,
          targetId: row.id,
          detail: { by: 'agent', byDelegation: true },
        })
    }
    for (const notice of step.notices)
      env.outbox.push({ memberId: notice.to, meeting: meetingNoticeOf(row, notice) })
  })

/** Keeps the invitation the opener's agent sent; its id and link are never audited or logged. */
export const keepInvite = (
  id: DebateId,
  invite: { readonly inviteUid?: string | undefined; readonly meetingUrl?: string | undefined },
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* run(sql`
      UPDATE scheduling_rooms SET invite_uid = ${invite.inviteUid ?? null}, meeting_url = ${invite.meetingUrl ?? null},
      invite_state = 'sent', invite_changed_at = ${env.clock.now()} WHERE debate_id = ${id}`)
  })

export const cancelInvite = (id: DebateId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* run(sql`
      UPDATE scheduling_rooms SET invite_state = 'cancelled', invite_changed_at = ${env.clock.now()}
      WHERE debate_id = ${id}`)
  })

/** Never a time, an invitation id or a link. */
export interface MeetingNotice {
  readonly debateId: DebateId
  readonly title: string
  readonly toOpener: boolean
  readonly notice: AttendanceNotice | JoinedNotice
}

/** The person's agent joined the room by their delegation; the first time it is named. */
export interface JoinedNotice {
  readonly to: MemberId
  readonly notice: 'joined'
  readonly agentName: string | null
}

const meetingNoticeOf = (
  row: Pick<DebateRow, 'id' | 'question' | 'created_by'>,
  notice: AttendanceNotice,
): MeetingNotice => ({
  debateId: row.id,
  title: row.question,
  toOpener: notice.to === row.created_by,
  notice,
})
