import { Task as T } from '@homingbird/kernel'
import type { MemberId, Note, NoteId } from '@homingbird/protocol'
import { type RequestEnv, emit } from '../events/events.ts'
import { all } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { participantsOf } from './conversations.ts'
import { type NoteRow, hydrateNotes } from './note-rows.ts'

/** Tells every participant of a sent note what its receipts say now; a draft announces nothing. */
export const announceStatus = (id: NoteId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const note = yield* noteById(id, null)
    if (note.status !== 'sent') return
    const participants = yield* participantsOf(note.conversationId)
    yield* emit(participants, {
      type: 'note.status',
      noteId: note.id,
      conversationId: note.conversationId,
      receipts: note.receipts,
    })
  })

/** Tells every participant of a sent note how it reads now, after an edit in Slack or a change to its post there. */
export const announceChange = (id: NoteId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const note = yield* noteById(id, null)
    if (note.status !== 'sent') return
    yield* emit(yield* participantsOf(note.conversationId), { type: 'note.changed', note })
  })

/** A note known to exist, as the viewer sees it; `null` views it as nobody in particular. */
export const noteById = (id: NoteId, viewerId: MemberId | null): T.Task<Note, never, RequestEnv> =>
  T.gen(function* () {
    const rows = yield* all<NoteRow>(sql`SELECT * FROM notes WHERE id = ${id}`)
    return (yield* hydrateNotes(rows, viewerId))[0]!
  })
