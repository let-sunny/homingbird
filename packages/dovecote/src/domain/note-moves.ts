import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type ConversationId,
  Forbidden,
  type MemberId,
  type Note,
  type NoteId,
} from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { abandonDraft } from './abandoned-drafts.ts'
import { answerersOf } from './channel-rows.ts'
import { roomForMovedQuestion } from './channels.ts'
import { participantsOf, participatedConversation } from './conversations.ts'
import type { NoteFailure } from './drafts.ts'
import type { NoteRow } from './note-rows.ts'
import { noteById } from './note-status.ts'
import { visibleNote } from './notes.ts'
import { moveNotices } from './notices.ts'
import { nextSendTime } from './send-time.ts'

export const moveToChannel = (
  caller: Caller,
  id: NoteId,
  channel: string,
): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller)) return yield* T.fail(Forbidden({ message: 'Only a person can move a note.' }))
    const note = yield* visibleNote(caller.member.id, id)
    const from = yield* participatedConversation(caller.member.id, note.conversationId)
    if (note.status !== 'sent' || note.inReplyTo !== null || from.kind !== 'channel')
      return yield* T.fail(Conflict({ message: 'Only a question asked in a channel can be moved.' }))
    const answered = yield* first(sql`SELECT id FROM notes WHERE in_reply_to = ${id} AND status = 'sent'`)
    if (answered !== null)
      return yield* T.fail(Conflict({ message: 'This question already has an answer here.' }))
    const to = yield* roomForMovedQuestion(caller.member.id, note.authorId, from.id, channel)
    if (to === from.id)
      return yield* T.fail(Conflict({ message: 'The question is already in that channel.' }))
    const leftBehind = yield* participantsOf(from.id)
    const arrivingAt = yield* participantsOf(to)
    const now = yield* nextSendTime(to, env.clock.now())
    const movedReplies = yield* settleWaitingReplies(id, to, arrivingAt)
    yield* run(
      sql`UPDATE notes SET conversation_id = ${to}, sent_at = ${now}, updated_at = ${now} WHERE id = ${id}`,
    )
    yield* run(sql`DELETE FROM receipts WHERE note_id = ${id}`)
    yield* run(sql`DELETE FROM pickups WHERE note_id = ${id}`)
    yield* moveNotices(id, to)
    for (const memberId of (yield* answerersOf(to)).filter((helperId) => helperId !== note.authorId))
      yield* run(insertInto('receipts', { note_id: id, member_id: memberId, delivered_at: now }))
    yield* run(sql`UPDATE conversations SET last_activity_at = ${now} WHERE id = ${to}`)
    const moved = yield* noteById(id, null)
    yield* emit(leftBehind, {
      type: 'note.moved',
      noteId: id,
      fromConversationId: from.id,
      toConversationId: to,
    })
    yield* emit(arrivingAt, { type: 'note.sent', note: moved })
    for (const reply of movedReplies)
      yield* emit([reply.author_id], {
        type: 'draft.saved',
        note: yield* noteById(reply.id, reply.author_id),
      })
    return yield* noteById(id, caller.member.id)
  })

const settleWaitingReplies = (
  questionId: NoteId,
  to: ConversationId,
  arrivingAt: ReadonlyArray<MemberId>,
): T.Task<NoteRow[], never, RequestEnv> =>
  T.gen(function* () {
    const waiting = yield* all<NoteRow>(
      sql`SELECT * FROM notes WHERE in_reply_to = ${questionId} AND status = 'draft' ORDER BY id`,
    )
    const moving = waiting.filter((reply) => arrivingAt.includes(reply.author_id))
    for (const reply of waiting) if (!moving.includes(reply)) yield* abandonDraft(reply)
    for (const reply of moving)
      yield* run(sql`UPDATE notes SET conversation_id = ${to} WHERE id = ${reply.id}`)
    return moving
  })
