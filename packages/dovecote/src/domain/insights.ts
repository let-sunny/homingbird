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

/** The member's own agent: drafts, decisions and skips over the periods the report compares. */
export const agentReportFor = (memberId: MemberId): T.Task<AgentReport, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const now = env.clock.now()
    const activity = yield* agentActivity(memberId, now - LOOKBACK_MS, now)
    return agentReportOf(activity, now, env.config.insights.quickApprovalSeconds)
  })

/** Organization-wide totals for administrators, with every group under the minimum left out. */
export const organizationInsights: T.Task<OrganizationInsights, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  const now = env.clock.now()
  const activity = yield* organizationActivity(now - LOOKBACK_MS)
  const members = yield* first<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM members WHERE status = 'active'`,
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

const organizationActivity = (since: number): T.Task<OrganizationActivity, never, AppEnv> =>
  T.gen(function* () {
    const sent = yield* all<SentRow>(sql`
      SELECT n.id, n.author_id, n.in_reply_to, n.sent_at, ${PLACE_COLUMNS} FROM notes n ${PLACE_JOIN}
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
    return {
      sent: sent.map((row) => ({
        id: row.id,
        authorId: row.author_id,
        inReplyTo: row.in_reply_to,
        sentAt: Number(row.sent_at),
        place: placeOf(row),
      })),
      drafts: drafts.map((row) => ({ ...toDraft(row), authorId: row.author_id })),
      skips: skips.map((row) => ({ ...toDated(row), memberId: row.member_id })),
      debateResults: debateResults.map((row) => ({ authorId: row.author_id, sentAt: Number(row.sent_at) })),
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
