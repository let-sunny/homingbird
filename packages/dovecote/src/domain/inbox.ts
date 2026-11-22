import { Task as T } from '@homingbird/kernel'
import type { InboxItem } from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { conversationFor } from './conversations.ts'
import { membersByIds } from './members.ts'
import { type NoteRow, PICKUP_GRACE_MS, hydrateNotes } from './note-rows.ts'

export const notesAwaitingReply = (
  caller: Caller,
  onlyFresh: boolean,
): T.Task<InboxItem[], never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const viewerId = caller.member.id
    const notPickedUp = onlyFresh ? notHandledByAnyAgent(caller, env.clock.now()) : sql``
    const asked = isHuman(caller) ? sql`` : sql`AND (r.asked IS NULL OR r.asked = 1)`
    const rows = yield* all<NoteRow>(sql`
      SELECT n.* FROM notes n JOIN receipts r ON r.note_id = n.id AND r.member_id = ${viewerId}
      WHERE n.status = 'sent' AND r.replied_at IS NULL AND n.sent_at > ${env.clock.now() - INBOX_WINDOW_MS}
      AND NOT EXISTS (
        SELECT 1 FROM notes a JOIN conversations c ON c.id = a.conversation_id
        WHERE a.in_reply_to = n.id AND a.status = 'sent' AND c.kind = 'channel')
      ${asked} ${notPickedUp} ORDER BY n.sent_at, n.id LIMIT ${INBOX_LIMIT}`)
    const notes = yield* hydrateNotes(rows, viewerId)
    const authors = yield* membersByIds(notes.map((note) => note.authorId))
    const items: InboxItem[] = []
    for (const note of notes) {
      const conversation = yield* T.result(conversationFor(viewerId, note.conversationId, isHuman(caller)))
      const author = authors.get(note.authorId)
      if (conversation._tag === 'Ok' && author !== undefined)
        items.push({ note, author, conversation: conversation.value })
    }
    return items
  })

/** Two desks of one person never draft one note; one picked up and left comes back after the grace. */
const notHandledByAnyAgent = (caller: Caller, now: number) => sql`
  AND NOT EXISTS (SELECT 1 FROM pickups k WHERE k.note_id = n.id AND k.credential_id = ${caller.credential.id})
  AND (r.drafting_at IS NULL OR r.drafting_at <= ${now - PICKUP_GRACE_MS})
  AND NOT EXISTS (SELECT 1 FROM releases s WHERE s.note_id = n.id AND s.member_id = ${caller.member.id})
  AND NOT EXISTS (
    SELECT 1 FROM notes d WHERE d.in_reply_to = n.id AND d.author_id = ${caller.member.id} AND d.status = 'draft')`

const INBOX_LIMIT = 50
const INBOX_WINDOW_MS = 30 * 24 * 60 * 60_000
