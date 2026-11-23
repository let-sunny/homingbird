import { Task as T } from '@homingbird/kernel'
import {
  type AttendanceState,
  type DebateId,
  type DebateSummary,
  MEETING_NOTICES_SHOWN_MAX,
  type MeetingNoticeShown,
  type MemberId,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, run } from '../sql/database.ts'
import { insertInto, list, sql } from '../sql/query.ts'
import type { MeetingNotice } from './meeting-rows.ts'

/** Keeps what a meeting tells a person, for the web client to list, and queues it for their devices. */
export const tellMeeting = (memberId: MemberId, meeting: MeetingNotice): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const { notice } = meeting
    yield* run(
      insertInto('meeting_notices', {
        id: env.random.identifier(),
        debate_id: meeting.debateId,
        member_id: memberId,
        notice: notice.notice,
        about_member_id: 'memberId' in notice ? notice.memberId : null,
        because: notice.notice === 'left' ? notice.because : null,
        agent_name: notice.notice === 'joined' ? notice.agentName : null,
        created_at: env.clock.now(),
      }),
    )
    env.outbox.push({ memberId, meeting })
  })

/**
 * The viewer's own part of each scheduling flock listed that asks them: how they answered, where their
 * meeting stands, and what it told them, newest first. Nobody else's part, and never a time.
 */
export const ownSchedulingParts = (
  viewerId: MemberId,
  ids: ReadonlyArray<DebateId>,
): T.Task<ReadonlyMap<DebateId, NonNullable<DebateSummary['mine']>>, never, AppEnv> =>
  T.gen(function* () {
    if (ids.length === 0) return new Map()
    const parts = yield* all<PartRow>(sql`
      SELECT a.debate_id, a.answer, a.state,
        EXISTS (SELECT 1 FROM debate_turns t WHERE t.debate_id = a.debate_id AND t.member_id = a.member_id) AS took_turn
      FROM scheduling_attendees a WHERE a.member_id = ${viewerId} AND a.debate_id IN ${list(ids)}`)
    const notices = yield* all<NoticeRow>(sql`
      SELECT debate_id, notice, about_member_id, because, agent_name, created_at FROM meeting_notices
      WHERE member_id = ${viewerId} AND debate_id IN ${list(ids)} ORDER BY created_at DESC, id`)
    return new Map(
      parts.map((part) => [
        part.debate_id,
        {
          answer: answerOf(part),
          ...(part.state !== null && { attendance: part.state }),
          notices: notices
            .filter((notice) => notice.debate_id === part.debate_id)
            .slice(0, MEETING_NOTICES_SHOWN_MAX)
            .map(shownNotice),
        },
      ]),
    )
  })

interface PartRow {
  readonly debate_id: DebateId
  readonly answer: string | null
  readonly state: AttendanceState | null
  readonly took_turn: number | boolean
}

interface NoticeRow {
  readonly debate_id: DebateId
  readonly notice: string
  readonly about_member_id: MemberId | null
  readonly because: string | null
  readonly agent_name: string | null
  readonly created_at: number
}

const answerOf = (part: PartRow): NonNullable<DebateSummary['mine']>['answer'] => {
  if (part.answer === 'by_person') return 'by_person'
  if (Number(part.took_turn) === 1) return 'by_agent'
  return part.answer === 'choosing' ? 'choosing' : 'waiting'
}

const shownNotice = (row: NoticeRow): MeetingNoticeShown => ({
  notice: row.notice as MeetingNoticeShown['notice'],
  memberId: row.about_member_id,
  because: row.because as MeetingNoticeShown['because'],
  agentName: row.agent_name,
  at: Number(row.created_at),
})
