import { Task as T } from '@homingbird/kernel'
import {
  type ConversationId,
  type MemberId,
  NotFound,
  type Note,
  type NoteId,
  type Notice,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all, first } from '../sql/database.ts'
import { containsIgnoringCase, sql } from '../sql/query.ts'
import { participatedConversation } from './conversations.ts'
import { type NoteRow, hydrateNotes } from './note-rows.ts'
import { noticesFor } from './notices.ts'

/** Rule 2: a viewer sees a note in a conversation they are in, once sent, or their own draft. */
export const visibleNote = (viewerId: MemberId, id: NoteId): T.Task<Note, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* first<NoteRow>(sql`
      SELECT n.* FROM notes n
      JOIN participants p ON p.conversation_id = n.conversation_id AND p.member_id = ${viewerId}
      WHERE n.id = ${id} AND (n.status = 'sent' OR n.author_id = ${viewerId})`)
    if (row === null) return yield* T.fail(NotFound({ message: 'No such note.' }))
    return (yield* hydrateNotes([row], viewerId))[0]!
  })

export const notesInConversation = (
  viewerId: MemberId,
  conversationId: ConversationId,
  page: { readonly before: number | null; readonly limit: number },
): T.Task<{ notes: Note[]; hasMore: boolean; notices: Notice[] }, NotFound, AppEnv> =>
  T.gen(function* () {
    yield* participatedConversation(viewerId, conversationId)
    const sentRows = yield* all<NoteRow>(sql`
      SELECT * FROM notes WHERE conversation_id = ${conversationId} AND status = 'sent'
      AND sent_at < ${page.before ?? Number.MAX_SAFE_INTEGER}
      ORDER BY sent_at DESC, id DESC LIMIT ${page.limit + 1}`)
    const ownDrafts =
      page.before === null
        ? yield* all<NoteRow>(sql`
            SELECT * FROM notes WHERE conversation_id = ${conversationId} AND status = 'draft'
            AND author_id = ${viewerId} ORDER BY created_at, id`)
        : []
    const notes = yield* hydrateNotes([...sentRows.slice(0, page.limit).reverse(), ...ownDrafts], viewerId)
    const notices = page.before === null ? yield* noticesFor(viewerId, conversationId) : []
    return { notes, hasMore: sentRows.length > page.limit, notices }
  })

export const draftsOf = (authorId: MemberId): T.Task<Note[], never, AppEnv> =>
  T.gen(function* () {
    const rows = yield* all<NoteRow>(
      sql`SELECT * FROM notes WHERE author_id = ${authorId} AND status = 'draft' ORDER BY created_at, id`,
    )
    return yield* hydrateNotes(rows, authorId)
  })

export const searchNotes = (
  viewerId: MemberId,
  needle: string,
  limit: number,
): T.Task<Note[], never, AppEnv> =>
  T.gen(function* () {
    const rows = yield* all<NoteRow>(sql`
      SELECT n.* FROM notes n
      JOIN participants p ON p.conversation_id = n.conversation_id AND p.member_id = ${viewerId}
      WHERE (n.status = 'sent' OR (n.status = 'draft' AND n.author_id = ${viewerId}))
      AND ${containsIgnoringCase('n.body', needle)}
      ORDER BY n.created_at DESC LIMIT ${limit}`)
    return yield* hydrateNotes(rows, viewerId)
  })
