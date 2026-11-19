import { Task as T } from '@homingbird/kernel'
import {
  type ConversationId,
  type CredentialId,
  type MemberId,
  type Note,
  type NoteId,
  type NoteStatus,
  type Origin,
  type Receipt,
  receiptState,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all } from '../sql/database.ts'
import { list, sql } from '../sql/query.ts'
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
    const sentIds = rows.filter((row) => row.status === 'sent').map((row) => row.id)
    if (sentIds.length === 0) return rows.map((row) => toNote(row, [], viewerId, details))
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
      ),
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
): Note => ({
  id: row.id,
  conversationId: row.conversation_id,
  authorId: row.author_id,
  status: row.status,
  body: row.body,
  inReplyTo: row.in_reply_to,
  origin: row.origin,
  agentName: row.agent_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sentAt: row.sent_at,
  receipts,
  ...(row.author_id === viewerId && { basis: row.basis }),
  ...(details && row.agent_name !== null && { agentClient: row.agent_client, agentModel: row.agent_model }),
})

const toReceipt = (row: ReceiptRow, replyDraftStartedAt: number | null, now: number): Receipt => {
  const pickedUpRecently = row.drafting_at !== null && now - row.drafting_at < PICKUP_GRACE_MS
  const times = {
    readAt: row.read_at,
    draftingAt: replyDraftStartedAt ?? (pickedUpRecently ? row.drafting_at : null),
    repliedAt: row.replied_at,
  }
  return { memberId: row.member_id, state: receiptState(times), deliveredAt: row.delivered_at, ...times }
}
