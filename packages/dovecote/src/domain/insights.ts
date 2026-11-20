import { Task as T } from '@homingbird/kernel'
import type { AgentReport, MemberId, OrganizationInsights } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all, first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { type OrganizationActivity, organizationInsightsOf } from './organization-figures.ts'
import { PLACE_COLUMNS, PLACE_JOIN, type PlaceRow, placeOf } from './places.ts'
import {
  type AgentActivity,
  DAY_MS,
  type DraftOutcome,
  PERIOD_DAYS,
  TREND_WEEKS,
  agentReportOf,
} from './trust-figures.ts'
import { WEEK_DAYS, type WeekActivity, yourWeekOf } from './week-figures.ts'

/** The member's own agent: drafts, decisions and skips over the periods the report compares. */
export const agentReportFor = (memberId: MemberId): T.Task<AgentReport, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const now = env.clock.now()
    const activity = yield* agentActivity(memberId, now - LOOKBACK_MS, now)
    return agentReportOf(activity, now, env.config.insights.quickApprovalSeconds)
  })

/** The member's own report with their week of notes beyond the agent, as `insights.mine` answers it. */
export const myInsights = (memberId: MemberId): T.Task<AgentReport, never, AppEnv> =>
  T.gen(function* () {
    const report = yield* agentReportFor(memberId)
    const week = yield* weekActivity(memberId, report.generatedAt - 2 * WEEK_DAYS * DAY_MS)
    return { ...report, week: yourWeekOf(week, report.generatedAt) }
  })

/** Organization-wide totals for administrators, with every group under the minimum left out. */
export const organizationInsights: T.Task<OrganizationInsights, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  const now = env.clock.now()
  const activity = yield* organizationActivity(now - LOOKBACK_MS)
  const members = yield* first<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM members WHERE status = 'active' AND kind = 'person'`,
  )
  const blocks = yield* first<{ total: number }>(sql`SELECT COUNT(*) AS total FROM blocks`)
  return organizationInsightsOf(
    activity,
    { members: Number(members?.total ?? 0), blocks: Number(blocks?.total ?? 0) },
    now,
    env.config.insights,
  )
})

const LOOKBACK_MS = Math.max(2 * Math.max(...PERIOD_DAYS), 7 * TREND_WEEKS) * DAY_MS

const agentActivity = (
  memberId: MemberId,
  since: number,
  now: number,
): T.Task<AgentActivity, never, AppEnv> =>
  T.gen(function* () {
    const drafts = yield* all<DraftRow>(sql`
      SELECT n.created_at, n.seen_at, n.decided_at, n.status, n.origin, n.agent_client, n.agent_model,
        n.agent_name, n.session_minutes, n.context_percent, ${PLACE_COLUMNS}
      FROM notes n ${PLACE_JOIN}
      WHERE n.author_id = ${memberId} AND n.agent_name IS NOT NULL AND n.debate_id IS NULL
      AND (n.created_at >= ${since} OR n.decided_at >= ${since})`)
    const handWritten = yield* all<DatedRow>(sql`
      SELECT n.sent_at AS at, ${PLACE_COLUMNS} FROM notes n ${PLACE_JOIN}
      WHERE n.author_id = ${memberId} AND n.agent_name IS NULL AND n.debate_id IS NULL AND n.status = 'sent'
      AND n.sent_at >= ${since}`)
    const debateResults = yield* all<DatedRow>(sql`
      SELECT n.sent_at AS at, ${PLACE_COLUMNS} FROM notes n ${PLACE_JOIN}
      WHERE n.author_id = ${memberId} AND n.debate_id IS NOT NULL AND n.status = 'sent'
      AND n.sent_at >= ${since}`)
    const skips = yield* all<SkipRow>(sql`
      SELECT n.created_at AS at, n.reason, ${PLACE_COLUMNS} FROM releases n ${PLACE_JOIN}
      WHERE n.member_id = ${memberId} AND n.created_at >= ${since}
      ORDER BY n.created_at`)
    const expired = yield* all<DatedRow>(sql`
      SELECT n.expires_at AS at, ${PLACE_COLUMNS} FROM draft_requests n ${PLACE_JOIN}
      WHERE n.member_id = ${memberId} AND n.cancelled_at IS NULL
      AND n.expires_at >= ${since} AND n.expires_at <= ${now}
      AND NOT EXISTS (SELECT 1 FROM draft_request_answers a WHERE a.request_id = n.id)`)
    return {
      drafts: drafts.map(toDraft),
      handWritten: handWritten.map(toDated),
      debateResults: debateResults.map(toDated),
      skips: skips.map((row) => ({ ...toDated(row), reason: row.reason })),
      expiredRequests: expired.map(toDated),
    }
  })

const weekActivity = (memberId: MemberId, since: number): T.Task<WeekActivity, never, AppEnv> =>
  T.gen(function* () {
    const sent = yield* all<{ at: number }>(sql`
      SELECT n.sent_at AS at FROM notes n
      WHERE n.author_id = ${memberId} AND n.status = 'sent' AND n.debate_id IS NULL AND n.sent_at >= ${since}`)
    const repliesReceived = yield* all<{ at: number }>(sql`
      SELECT r.sent_at AS at FROM notes r JOIN notes o ON o.id = r.in_reply_to
      WHERE o.author_id = ${memberId} AND o.status = 'sent' AND o.debate_id IS NULL
      AND r.author_id <> ${memberId} AND r.status = 'sent' AND r.debate_id IS NULL AND r.sent_at >= ${since}`)
    const ownReplies = yield* all<{ id: string; original_sent_at: number; replied_at: number }>(sql`
      SELECT o.id, o.sent_at AS original_sent_at, r.sent_at AS replied_at FROM notes o
      JOIN notes r ON r.in_reply_to = o.id
      WHERE r.author_id = ${memberId} AND r.status = 'sent' AND r.debate_id IS NULL
      AND o.author_id <> ${memberId} AND o.status = 'sent' AND o.debate_id IS NULL AND o.in_reply_to IS NULL
      AND o.sent_at >= ${since}`)
    return {
      sent: sent.map((row) => Number(row.at)),
      repliesReceived: repliesReceived.map((row) => Number(row.at)),
      ownReplies: ownReplies.map((row) => ({
        originalId: row.id,
        originalSentAt: Number(row.original_sent_at),
        repliedAt: Number(row.replied_at),
      })),
    }
  })

const organizationActivity = (since: number): T.Task<OrganizationActivity, never, AppEnv> =>
  T.gen(function* () {
    const sent = yield* all<SentRow>(sql`
      SELECT n.id, n.author_id, n.in_reply_to, n.sent_at, n.origin, ${PLACE_COLUMNS} FROM notes n ${PLACE_JOIN}
      WHERE n.status = 'sent' AND n.debate_id IS NULL AND n.sent_at >= ${since}`)
    const drafts = yield* all<DraftRow & { author_id: string }>(sql`
      SELECT n.author_id, n.created_at, n.seen_at, n.decided_at, n.status, n.origin, n.agent_client, n.agent_model, ${PLACE_COLUMNS}
      FROM notes n ${PLACE_JOIN}
      WHERE n.agent_name IS NOT NULL AND n.debate_id IS NULL AND (n.created_at >= ${since} OR n.decided_at >= ${since})`)
    const skips = yield* all<DatedRow & { member_id: string }>(sql`
      SELECT n.member_id, n.created_at AS at, ${PLACE_COLUMNS} FROM releases n ${PLACE_JOIN}
      WHERE n.created_at >= ${since}`)
    const debateResults = yield* all<{ author_id: string; sent_at: number }>(sql`
      SELECT n.author_id, n.sent_at FROM notes n
      WHERE n.status = 'sent' AND n.debate_id IS NOT NULL AND n.sent_at >= ${since}`)
    const received = yield* all<ReceivedRow>(sql`
      SELECT r.member_id, n.sent_at,
        CASE WHEN EXISTS (
          SELECT 1 FROM credentials k WHERE k.member_id = r.member_id AND k.kind = 'agent'
          AND k.created_at <= n.sent_at AND k.expires_at > n.sent_at
          AND (k.revoked_at IS NULL OR k.revoked_at > n.sent_at)
        ) THEN 1 ELSE 0 END AS has_agent,
        (SELECT MIN(p.picked_at) FROM pickups p JOIN credentials k ON k.id = p.credential_id
          WHERE p.note_id = n.id AND k.member_id = r.member_id AND k.kind = 'agent') AS picked_up_at
      FROM receipts r JOIN notes n ON n.id = r.note_id
      WHERE n.status = 'sent' AND n.debate_id IS NULL AND n.sent_at >= ${since} AND r.member_id <> n.author_id`)
    return {
      sent: sent.map((row) => ({
        id: row.id,
        authorId: row.author_id,
        inReplyTo: row.in_reply_to,
        sentAt: Number(row.sent_at),
        place: placeOf(row),
        origin: row.origin,
      })),
      drafts: drafts.map((row) => ({ ...toDraft(row), authorId: row.author_id })),
      skips: skips.map((row) => ({ ...toDated(row), memberId: row.member_id })),
      debateResults: debateResults.map((row) => ({ authorId: row.author_id, sentAt: Number(row.sent_at) })),
      received: received.map((row) => ({
        recipientId: row.member_id,
        sentAt: Number(row.sent_at),
        hasAgent: Number(row.has_agent) === 1,
        pickedUpAt: optionalNumber(row.picked_up_at),
      })),
    }
  })

interface DraftRow extends PlaceRow {
  readonly created_at: number
  readonly seen_at: number | null
  readonly decided_at: number | null
  readonly status: string
  readonly origin: string
  readonly agent_client: string | null
  readonly agent_model: string | null
  readonly agent_name?: string | null
  readonly session_minutes?: number | null
  readonly context_percent?: number | null
}

interface DatedRow extends PlaceRow {
  readonly at: number
}

interface SkipRow extends DatedRow {
  readonly reason: string | null
}

interface SentRow extends PlaceRow {
  readonly id: string
  readonly author_id: string
  readonly in_reply_to: string | null
  readonly sent_at: number
  readonly origin: string
}

interface ReceivedRow {
  readonly member_id: string
  readonly sent_at: number
  readonly has_agent: number
  readonly picked_up_at: number | null
}

const toDated = (row: DatedRow) => ({ place: placeOf(row), at: Number(row.at) })

const toDraft = (row: DraftRow) => ({
  place: placeOf(row),
  createdAt: Number(row.created_at),
  seenAt: optionalNumber(row.seen_at),
  decidedAt: optionalNumber(row.decided_at),
  outcome: outcomeOf(row),
  client: row.agent_client,
  model: row.agent_model,
  agentName: row.agent_name ?? null,
  sessionMinutes: optionalNumber(row.session_minutes ?? null),
  contextPercent: optionalNumber(row.context_percent ?? null),
})

const outcomeOf = (row: DraftRow): DraftOutcome | null =>
  row.status === 'sent'
    ? row.origin === 'agent'
      ? 'as_written'
      : 'edited'
    : row.status === 'discarded' && row.decided_at !== null
      ? 'discarded'
      : null

const optionalNumber = (value: number | null): number | null => (value === null ? null : Number(value))
