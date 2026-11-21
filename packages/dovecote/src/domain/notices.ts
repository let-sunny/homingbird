import { Task as T } from '@homingbird/kernel'
import type { ConversationId, MemberId, NoteId, Notice, NoticeKind } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'

/** What happened to the viewer's notes in a conversation: a released note until it has a reply draft, an archived channel's discarded draft. */
export const noticesFor = (
  viewerId: MemberId,
  conversationId: ConversationId,
): T.Task<Notice[], never, AppEnv> =>
  T.map((rows: ReadonlyArray<NoticeRow>) => rows.map(toNotice))(
    all<NoticeRow>(sql`
      SELECT * FROM notices k WHERE k.member_id = ${viewerId} AND k.conversation_id = ${conversationId}
      AND NOT (k.kind = 'released' AND EXISTS (
        SELECT 1 FROM notes n WHERE n.in_reply_to = k.note_id AND n.author_id = ${viewerId}
        AND n.status IN ('draft', 'sent')))
      ORDER BY k.created_at, k.note_id`),
  )

export const keepNotice = (notice: {
  readonly memberId: MemberId
  readonly kind: NoticeKind
  readonly noteId: NoteId
  readonly conversationId: ConversationId
  readonly reason: string | null
  readonly agentName: string | null
  readonly channel: string | null
}): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    yield* forgetNotice(notice.memberId, notice.noteId)
    yield* run(
      insertInto('notices', {
        member_id: notice.memberId,
        note_id: notice.noteId,
        conversation_id: notice.conversationId,
        kind: notice.kind,
        reason: notice.reason,
        agent_name: notice.agentName,
        channel: notice.channel,
        created_at: env.clock.now(),
      }),
    )
  })

export const forgetNotice = (memberId: MemberId, noteId: NoteId): T.Task<void, never, AppEnv> =>
  T.asUnit(run(sql`DELETE FROM notices WHERE member_id = ${memberId} AND note_id = ${noteId}`))

interface NoticeRow {
  readonly member_id: MemberId
  readonly note_id: NoteId
  readonly conversation_id: ConversationId
  readonly kind: NoticeKind
  readonly reason: string | null
  readonly agent_name: string | null
  readonly channel: string | null
  readonly created_at: number
}

const toNotice = (row: NoticeRow): Notice => ({
  kind: row.kind,
  noteId: row.note_id,
  conversationId: row.conversation_id,
  reason: row.reason,
  agentName: row.agent_name,
  channel: row.channel,
  at: Number(row.created_at),
})
