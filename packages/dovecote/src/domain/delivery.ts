import { Task as T } from '@homingbird/kernel'
import { Conflict, DRAFT_CHANGED, type DraftAsShown, type MemberId, type NoteId } from '@homingbird/protocol'
import { type RequestEnv, emit } from '../events/events.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { equalsExactly, insertInto, sql } from '../sql/query.ts'
import { abandonDraft } from './abandoned-drafts.ts'
import { answerersOf } from './channel-rows.ts'
import { participantsOf } from './conversations.ts'
import { announcePreview } from './draft-previews.ts'
import type { NoteFailure } from './drafts.ts'
import type { NoteRow } from './note-rows.ts'
import { announceStatus, noteById } from './note-status.ts'
import { privateQuestionRecipients } from './private-questions.ts'
import { nextSendTime } from './send-time.ts'

/**
 * Sends a draft as decided: only while its row still holds the text and room the decision was made on,
 * checked in the same `UPDATE`, then delivered to its recipients and announced to the room.
 */
export const deliverDraft = (
  draft: NoteRow,
  decision: {
    readonly body: string
    readonly origin: NoteRow['origin']
    readonly approvedBy: MemberId | null
    readonly autoPrincipleId: string | null
    readonly expected: DraftAsShown
  },
  decidedAt: number,
): T.Task<void, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const { id, author_id: authorId } = draft
    const { body, origin, approvedBy, autoPrincipleId, expected } = decision
    const participants = yield* participantsOf(draft.conversation_id)
    const recipients = yield* recipientsOf(draft, participants)
    const now = yield* nextSendTime(draft.conversation_id, decidedAt)
    const sameBody = equalsExactly(yield* dialect, 'body', expected.body)
    const sent = yield* run(
      sql`UPDATE notes SET status = 'sent', body = ${body}, origin = ${origin}, sent_at = ${now}, updated_at = ${now}, decided_at = ${decidedAt}, approved_by = ${approvedBy}, auto_principle_id = ${autoPrincipleId} WHERE id = ${id} AND status = 'draft' AND ${sameBody} AND conversation_id = ${expected.conversationId}`,
    )
    if (sent === 0) return yield* T.fail(yield* refusalAfterMissedSend(id))
    for (const memberId of recipients)
      yield* run(insertInto('receipts', { note_id: id, member_id: memberId, delivered_at: now }))
    yield* run(sql`UPDATE conversations SET last_activity_at = ${now} WHERE id = ${draft.conversation_id}`)
    if (draft.in_reply_to !== null) yield* settleReply(authorId, draft.in_reply_to, now)
    yield* emit(participants, { type: 'note.sent', note: yield* noteById(id, null) })
    yield* announcePreview(draft)
    if (draft.in_reply_to !== null) yield* announceStatus(draft.in_reply_to)
  })

const refusalAfterMissedSend = (id: NoteId): T.Task<NoteFailure, never, RequestEnv> =>
  T.map((row: { status: string } | null) =>
    Conflict({
      message: row?.status === 'draft' ? DRAFT_CHANGED : 'This draft was already sent or discarded.',
    }),
  )(first<{ status: string }>(sql`SELECT status FROM notes WHERE id = ${id}`))

const recipientsOf = (
  draft: NoteRow,
  participants: ReadonlyArray<MemberId>,
): T.Task<MemberId[], never, RequestEnv> =>
  T.gen(function* () {
    const privately = yield* privateQuestionRecipients(draft.conversation_id, draft.author_id)
    if (privately !== null) return privately
    const others = participants.filter((memberId) => memberId !== draft.author_id)
    const room = yield* first<{ kind: string }>(
      sql`SELECT kind FROM conversations WHERE id = ${draft.conversation_id}`,
    )
    if (room?.kind !== 'channel') return others
    const answered =
      draft.in_reply_to === null
        ? null
        : yield* first<{ author_id: MemberId }>(
            sql`SELECT author_id FROM notes WHERE id = ${draft.in_reply_to}`,
          )
    if (answered !== null && answered.author_id !== draft.author_id)
      return others.filter((memberId) => memberId === answered.author_id)
    const helpers = new Set(yield* answerersOf(draft.conversation_id))
    return others.filter((memberId) => helpers.has(memberId))
  })

const settleReply = (authorId: MemberId, repliedTo: NoteId, now: number): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    yield* run(
      sql`UPDATE receipts SET replied_at = ${now}, read_at = COALESCE(read_at, ${now}) WHERE note_id = ${repliedTo} AND member_id = ${authorId}`,
    )
    const alternatives = yield* all<NoteRow>(
      sql`SELECT * FROM notes WHERE in_reply_to = ${repliedTo} AND author_id = ${authorId} AND status = 'draft'`,
    )
    for (const alternative of alternatives) yield* abandonDraft(alternative)
  })
