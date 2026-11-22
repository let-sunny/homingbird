import { Task as T } from '@homingbird/kernel'
import type { MemberId } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { type RequestEnv, transact } from '../events/events.ts'
import { all } from '../sql/database.ts'
import { type Query, sql } from '../sql/query.ts'
import { recordAudit } from './audit.ts'
import type { NoteRow } from './note-rows.ts'

/**
 * Writes every note a person wrote or approved, in every status, as one JSON object a line, oldest
 * first, and audits the export with how many it wrote. Notes others wrote to them are those others'.
 */
export const exportNotesOf = (
  memberId: MemberId,
  write: (line: string) => void,
): T.Task<number, never, AppEnv> =>
  T.gen(function* () {
    const written = yield* exportFrom(memberId, null, 0, write)
    yield* transact(recordExport(memberId, written))
    return written
  })

const exportedNote = (row: ExportedRow): Record<string, unknown> => ({
  id: row.id,
  conversationId: row.conversation_id,
  conversationKind: row.conversation_kind,
  channel: row.channel,
  status: row.status,
  origin: row.origin,
  authorId: row.author_id,
  approvedBy: row.approved_by,
  inReplyTo: row.in_reply_to,
  debateId: row.debate_id,
  body: row.body,
  agentBody: row.agent_body,
  basis: row.basis,
  sources: row.sources === null ? null : JSON.parse(row.sources),
  discardReason: row.discard_reason,
  agentName: row.agent_name,
  agentClient: row.agent_client,
  agentModel: row.agent_model,
  createdAt: isoOf(row.created_at),
  sentAt: isoOf(row.sent_at),
  decidedAt: isoOf(row.decided_at),
})

type ExportedRow = NoteRow & {
  readonly conversation_kind: string
  readonly channel: string | null
}

const exportFrom = (
  memberId: MemberId,
  after: { readonly createdAt: number; readonly id: string } | null,
  writtenBefore: number,
  write: (line: string) => void,
): T.Task<number, never, AppEnv> =>
  T.gen(function* () {
    const page = yield* all<ExportedRow>(sql`
      SELECT n.*, c.kind AS conversation_kind, ch.slug AS channel FROM notes n
      JOIN conversations c ON c.id = n.conversation_id
      LEFT JOIN channels ch ON ch.conversation_id = n.conversation_id
      WHERE (n.author_id = ${memberId} OR n.approved_by = ${memberId}) AND ${laterThan(after)}
      ORDER BY n.created_at, n.id LIMIT ${EXPORT_PAGE}`)
    for (const row of page) write(JSON.stringify(exportedNote(row)))
    const written = writtenBefore + page.length
    const last = page.at(-1)
    return last === undefined || page.length < EXPORT_PAGE
      ? written
      : yield* exportFrom(memberId, { createdAt: Number(last.created_at), id: last.id }, written, write)
  })

const laterThan = (after: { readonly createdAt: number; readonly id: string } | null): Query =>
  after === null
    ? sql`1 = 1`
    : sql`(n.created_at > ${after.createdAt} OR (n.created_at = ${after.createdAt} AND n.id > ${after.id}))`

const recordExport = (memberId: MemberId, notes: number): T.Task<void, never, RequestEnv> =>
  recordAudit('note.exported', { targetId: memberId, detail: { notes } })

const isoOf = (at: number | null): string | null => (at === null ? null : new Date(Number(at)).toISOString())

const EXPORT_PAGE = 500
