import { Task as T } from '@homingbird/kernel'
import { Conflict, Forbidden, NotFound, type Note, type NoteId, RECALL_WINDOW_MS } from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { first, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { participantsOf } from './conversations.ts'
import type { NoteRow } from './note-rows.ts'
import { announceStatus, noteById } from './note-status.ts'

/**
 * Takes back, within five minutes, a note the author's saved answer sent: recipients stop seeing it, the
 * author sees it recalled. A note sent with a click cannot be.
 */
export const recallNote = (
  caller: Caller,
  id: NoteId,
): T.Task<Note, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller)) return yield* T.fail(Forbidden({ message: 'Only a person can recall a note.' }))
    const note = yield* first<NoteRow>(
      sql`SELECT * FROM notes WHERE id = ${id} AND author_id = ${caller.member.id} AND status <> 'draft'`,
    )
    if (note === null) return yield* T.fail(NotFound({ message: 'No such note.' }))
    if (note.status !== 'sent' || (note.auto_principle_id ?? null) === null)
      return yield* T.fail(Conflict({ message: 'Only a note your saved answer sent can be recalled.' }))
    const now = env.clock.now()
    if (now - Number(note.sent_at) >= RECALL_WINDOW_MS)
      return yield* T.fail(
        Conflict({ message: 'A note can be recalled only in the first five minutes after it was sent.' }),
      )
    const withdrawn = yield* run(
      sql`UPDATE notes SET status = 'withdrawn', withdrawn_at = ${now}, updated_at = ${now} WHERE id = ${id} AND status = 'sent'`,
    )
    if (withdrawn === 0) return yield* T.fail(Conflict({ message: 'This note was already recalled.' }))
    yield* run(sql`DELETE FROM receipts WHERE note_id = ${id}`)
    if (note.in_reply_to !== null) yield* unsettleReply(note)
    yield* emit(yield* participantsOf(note.conversation_id), {
      type: 'note.withdrawn',
      noteId: id,
      conversationId: note.conversation_id,
    })
    if (note.in_reply_to !== null) yield* announceStatus(note.in_reply_to)
    return yield* noteById(id, caller.member.id)
  })

const unsettleReply = (reply: NoteRow): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    yield* run(sql`UPDATE receipts SET replied_at = NULL
      WHERE note_id = ${reply.in_reply_to} AND member_id = ${reply.author_id}
      AND NOT EXISTS (SELECT 1 FROM notes r
        WHERE r.in_reply_to = ${reply.in_reply_to} AND r.author_id = ${reply.author_id} AND r.status = 'sent')`)
  })
