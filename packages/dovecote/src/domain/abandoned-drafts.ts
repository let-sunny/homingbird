import { Task as T } from '@homingbird/kernel'
import type { ConversationId, MemberId } from '@homingbird/protocol'
import { type RequestEnv, emit } from '../events/events.ts'
import { all, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import type { NoteRow } from './note-rows.ts'

export const abandonDraft = (draft: NoteRow): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* run(
      sql`UPDATE notes SET status = 'discarded', updated_at = ${env.clock.now()} WHERE id = ${draft.id} AND status = 'draft'`,
    )
    yield* emit([draft.author_id], {
      type: 'draft.discarded',
      noteId: draft.id,
      conversationId: draft.conversation_id,
    })
  })

export const abandonDraftsIn = (
  conversationId: ConversationId,
  authorId: MemberId,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const drafts = yield* all<NoteRow>(
      sql`SELECT * FROM notes WHERE conversation_id = ${conversationId} AND author_id = ${authorId} AND status = 'draft' ORDER BY id`,
    )
    for (const draft of drafts) yield* abandonDraft(draft)
  })
