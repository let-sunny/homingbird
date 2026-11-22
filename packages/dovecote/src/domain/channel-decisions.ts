import { Task as T } from '@homingbird/kernel'
import {
  CHANNEL_DECISIONS_DAYS,
  CHANNEL_DECISIONS_MAX,
  type ChannelDecision,
  type ChannelDecisions,
  type ConversationId,
  type MemberId,
  NotFound,
  type NoteId,
  type PrincipleId,
} from '@homingbird/protocol'
import { type AppEnv, type Caller, isHuman, viewerOf } from '../environment.ts'
import { all } from '../sql/database.ts'
import { list, sql } from '../sql/query.ts'
import { managersOf, visibleChannel } from './channel-rows.ts'
import { featureIsOn } from './settings.ts'
import { DAY_MS } from './trust-figures.ts'

/**
 * What the managers of a channel decided on its agent's answers in the last days, newest first, for a
 * person who manages it now and nobody else (rule 6). The query itself keeps to the conversations the
 * viewer is in and the group they manage, and leaves out every answer to a question they asked, whose
 * draft and edits are hidden from them (rule 2).
 */
export const channelDecisionsFor = (
  caller: Caller,
  slug: string,
): T.Task<ChannelDecisions, NotFound, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const row = yield* visibleChannel(viewerOf(caller), slug)
    const managers = yield* managersOf(row)
    if (!isHuman(caller) || !managers.includes(caller.member.id))
      return yield* T.fail(NotFound({ message: NOT_A_MANAGER }))
    const viewerId = caller.member.id
    const since = env.clock.now() - CHANNEL_DECISIONS_DAYS * DAY_MS
    const rows = yield* all<DecisionRow>(sql`
      SELECT n.id, n.conversation_id, n.status, n.origin, n.body, n.agent_body, n.discard_reason,
        n.approved_by, n.discarded_by, n.decided_at, c.channel_id AS asked_of,
        q.id AS question_id, q.author_id AS question_author, q.body AS question_body
      FROM notes n
      JOIN members a ON a.id = n.author_id AND a.kind = 'channel_agent'
      JOIN conversations c ON c.id = n.conversation_id
      JOIN channels t ON t.conversation_id = COALESCE(c.channel_id, c.id)
      JOIN group_members g ON g.group_id = t.manager_group_id AND g.member_id = ${viewerId}
      JOIN participants p ON p.conversation_id = n.conversation_id AND p.member_id = ${viewerId}
      LEFT JOIN notes q ON q.id = n.in_reply_to AND q.status = 'sent'
      WHERE t.slug = ${row.slug} AND n.debate_id IS NULL AND n.decided_at >= ${since}
        AND n.status IN ('sent', 'discarded')
        AND NOT EXISTS (SELECT 1 FROM notes o WHERE o.id = n.in_reply_to AND o.author_id = ${viewerId})
        AND (c.asked_by IS NULL OR c.asked_by <> ${viewerId})
      ORDER BY n.decided_at DESC, n.id DESC LIMIT ${CHANNEL_DECISIONS_MAX}`)
    const applied = yield* principlesApplied(rows.map((each) => each.id))
    return {
      channel: row.slug,
      days: CHANNEL_DECISIONS_DAYS,
      decisions: rows.map((each) => toDecision(each, applied.get(each.id) ?? [])),
    }
  })

const NOT_A_MANAGER = 'Only the managers of this channel see what was decided on its agent’s answers.'

/** The principles each answer said it applied, by title; none while the organization keeps teaching off. */
const principlesApplied = (
  ids: ReadonlyArray<NoteId>,
): T.Task<ReadonlyMap<NoteId, ChannelDecision['principles']>, never, AppEnv> =>
  T.gen(function* () {
    if (ids.length === 0 || !(yield* featureIsOn('teaching'))) return new Map()
    const rows = yield* all<{ note_id: NoteId; id: PrincipleId; topic: string }>(sql`
      SELECT a.note_id, p.id, p.topic FROM principle_applications a
      JOIN principles p ON p.id = a.principle_id AND p.member_id = a.member_id
      WHERE a.note_id IN ${list(ids)} ORDER BY p.position, p.id`)
    return new Map(
      [...Map.groupBy(rows, (each) => each.note_id)].map(([id, principles]) => [
        id,
        principles.map(({ id: principleId, topic }) => ({ id: principleId, topic })),
      ]),
    )
  })

const toDecision = (row: DecisionRow, principles: ChannelDecision['principles']): ChannelDecision => {
  const outcome = outcomeOf(row)
  return {
    noteId: row.id,
    conversationId: row.conversation_id,
    privately: row.asked_of !== null,
    outcome,
    decidedBy: outcome === 'discarded' ? row.discarded_by : row.approved_by,
    decidedAt: Number(row.decided_at),
    question:
      row.question_id === null
        ? null
        : { id: row.question_id, authorId: row.question_author!, body: row.question_body! },
    answer: row.body,
    agentAnswer: outcome === 'sent_edited' ? row.agent_body : null,
    reason: outcome === 'discarded' ? row.discard_reason : null,
    principles,
  }
}

const outcomeOf = (row: DecisionRow): ChannelDecision['outcome'] =>
  row.status === 'discarded' ? 'discarded' : row.origin === 'agent' ? 'sent_as_written' : 'sent_edited'

interface DecisionRow {
  readonly id: NoteId
  readonly conversation_id: ConversationId
  readonly status: 'sent' | 'discarded'
  readonly origin: string
  readonly body: string
  readonly agent_body: string | null
  readonly discard_reason: string | null
  readonly approved_by: MemberId | null
  readonly discarded_by: MemberId | null
  readonly decided_at: number
  readonly asked_of: string | null
  readonly question_id: NoteId | null
  readonly question_author: MemberId | null
  readonly question_body: string | null
}
