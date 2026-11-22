import { Task as T } from '@homingbird/kernel'
import {
  type ConversationId,
  type CredentialId,
  type DebateId,
  type MemberId,
  type Note,
  type NoteId,
  type NoteStatus,
  type Origin,
  type Receipt,
  receiptState,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { type SlackFacts, slackFactsOf } from '../slack/slack-note-facts.ts'
import { all } from '../sql/database.ts'
import { list, sql } from '../sql/query.ts'
import { sourcesShown } from './draft-sources.ts'
import { tagsShown } from './note-tags.ts'
import { featureIsOn } from './settings.ts'

export interface NoteRow {
  readonly id: NoteId
  readonly conversation_id: ConversationId
  readonly author_id: MemberId
  readonly status: NoteStatus
  readonly body: string
  readonly in_reply_to: NoteId | null
  readonly origin: Origin
  readonly agent_name: string | null
  readonly credential_id: CredentialId | null
  readonly created_at: number
  readonly updated_at: number
  readonly sent_at: number | null
  readonly basis: string | null
  readonly seen_at: number | null
  readonly decided_at: number | null
  readonly agent_body: string | null
  readonly agent_client: string | null
  readonly agent_model: string | null
  readonly session_minutes: number | null
  readonly context_percent: number | null
  readonly debate_id: DebateId | null
  readonly approved_by: MemberId | null
  readonly sources: string | null
  readonly discard_reason: string | null
  readonly auto_principle_id?: string | null
  readonly withdrawn_at?: number | null
  readonly discarded_by: MemberId | null
  readonly tags?: string | null
}

export const PICKUP_GRACE_MS = 10 * 60_000

/**
 * Notes as `viewerId` sees them: only the author sees what a draft was based on, and what wrote an agent's
 * note is shown only while the organization keeps note details on; it is recorded either way.
 */
export const hydrateNotes = (
  rows: ReadonlyArray<NoteRow>,
  viewerId: MemberId | null,
): T.Task<Note[], never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const details = rows.some((row) => row.agent_name !== null) && (yield* featureIsOn('noteDetails'))
    const debates = yield* debatesBehind(rows)
    const slack = yield* slackFactsOf(rows)
    const sentIds = rows.filter((row) => row.status === 'sent').map((row) => row.id)
    if (sentIds.length === 0) return rows.map((row) => toNote(row, [], viewerId, details, debates, slack))
    const receiptRows = yield* all<ReceiptRow>(
      sql`SELECT * FROM receipts WHERE note_id IN ${list(sentIds)} ORDER BY member_id`,
    )
    const replyDrafts = yield* all<ReplyDraftRow>(
      sql`SELECT in_reply_to, author_id, MIN(created_at) AS started_at FROM notes
          WHERE status = 'draft' AND in_reply_to IN ${list(sentIds)} GROUP BY in_reply_to, author_id`,
    )
    const draftStartedAt = new Map(
      replyDrafts.map((row) => [`${row.in_reply_to}:${row.author_id}`, Number(row.started_at)]),
    )
    const receiptsByNote = Map.groupBy(receiptRows, (row) => row.note_id)
    return rows.map((row) =>
      toNote(
        row,
        (receiptsByNote.get(row.id) ?? []).map((receipt) =>
          toReceipt(
            receipt,
            draftStartedAt.get(`${receipt.note_id}:${receipt.member_id}`) ?? null,
            env.clock.now(),
          ),
        ),
        viewerId,
        details,
        debates,
        slack,
      ),
    )
  })

type DebateOrigin = NonNullable<Note['fromDebate']>

/** The debate rooms some of these notes were posted from: their question and agents, by display name. */
const debatesBehind = (
  rows: ReadonlyArray<NoteRow>,
): T.Task<ReadonlyMap<DebateId, DebateOrigin>, never, AppEnv> =>
  T.gen(function* () {
    const ids = [...new Set(rows.flatMap((row) => (row.debate_id ? [row.debate_id] : [])))]
    if (ids.length === 0) return new Map()
    const rooms = yield* all<{ id: DebateId; question: string }>(
      sql`SELECT id, question FROM debates WHERE id IN ${list(ids)}`,
    )
    const agents = yield* all<{ debate_id: DebateId; agent_name: string; name: string }>(sql`
      SELECT p.debate_id, p.agent_name, m.name FROM debate_participants p JOIN members m ON m.id = p.member_id
      WHERE p.debate_id IN ${list(ids)} ORDER BY p.created_at, p.member_id`)
    return new Map(
      rooms.map((room) => [
        room.id,
        {
          debateId: room.id,
          question: room.question,
          agents: agents
            .filter((one) => one.debate_id === room.id)
            .map((one) => ({ agent: one.agent_name, person: one.name })),
        },
      ]),
    )
  })

interface ReceiptRow {
  readonly note_id: NoteId
  readonly member_id: MemberId
  readonly delivered_at: number
  readonly read_at: number | null
  readonly drafting_at: number | null
  readonly replied_at: number | null
}

interface ReplyDraftRow {
  readonly in_reply_to: NoteId
  readonly author_id: MemberId
  readonly started_at: number
}

const toNote = (
  row: NoteRow,
  receipts: ReadonlyArray<Receipt>,
  viewerId: MemberId | null,
  details: boolean,
  debates: ReadonlyMap<DebateId, DebateOrigin>,
  slack: SlackFacts,
): Note => ({
  id: row.id,
  conversationId: row.conversation_id,
  authorId: row.author_id,
  status: row.status,
  body: row.body,
  inReplyTo: row.in_reply_to,
  ...tagsShown(row),
  origin: row.origin,
  agentName: row.agent_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sentAt: row.sent_at,
  receipts,
  ...(row.author_id === viewerId && { basis: row.basis, ...sourcesShown(row) }),
  ...(details && row.agent_name !== null && { agentClient: row.agent_client, agentModel: row.agent_model }),
  ...(isAutoSent(row)
    ? { autoSent: true }
    : (row.approved_by ?? null) !== null && { approvedBy: row.approved_by }),
  ...(row.debate_id && debates.has(row.debate_id) && { fromDebate: debates.get(row.debate_id)! }),
  ...(slack.via.has(row.id) && { via: slack.via.get(row.id)! }),
  ...slack.posting.get(row.id),
})

/** Sent by its person's saved answer: the note records them as approver, and the wire says how. */
const isAutoSent = (row: NoteRow): boolean => (row.auto_principle_id ?? null) !== null

const toReceipt = (row: ReceiptRow, replyDraftStartedAt: number | null, now: number): Receipt => {
  const pickedUpRecently = row.drafting_at !== null && now - row.drafting_at < PICKUP_GRACE_MS
  const times = {
    readAt: row.read_at,
    draftingAt: replyDraftStartedAt ?? (pickedUpRecently ? row.drafting_at : null),
    repliedAt: row.replied_at,
  }
  return { memberId: row.member_id, state: receiptState(times), deliveredAt: row.delivered_at, ...times }
}
