import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  DRAFT_CHANGED,
  type DraftAsShown,
  Forbidden,
  type MemberId,
  type Note,
  type NoteId,
  isSameTags,
} from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { first, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { abandonDraft } from './abandoned-drafts.ts'
import { requireMayMessageIn } from './conversations.ts'
import { deliverDraft } from './delivery.ts'
import { type NoteFailure, originAfterEdit, ownDraft } from './drafts.ts'
import type { NoteRow } from './note-rows.ts'
import { announceStatus, noteById } from './note-status.ts'
import { tagsOf } from './note-tags.ts'
import { offerAfterDecision } from './principle-offers.ts'
import { announceReview } from './review-events.ts'
import { reviewedDraft, reviewersOf } from './reviews.ts'

export const sendDraft = (
  caller: Caller,
  id: NoteId,
  replacementBody: string | undefined,
  expected: DraftAsShown,
): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller)) return yield* T.fail(Forbidden({ message: 'Only a person can approve a note.' }))
    const { draft, approvedBy } = yield* draftToDecide(caller, id)
    const authorId = draft.author_id
    if (!isAsShown(draft, expected)) return yield* T.fail(Conflict({ message: DRAFT_CHANGED }))
    yield* requireMayMessageIn(authorId, draft.conversation_id)
    const body = replacementBody ?? draft.body
    const origin = originAfterEdit(draft.origin, true, body !== draft.body)
    yield* deliverDraft(draft, { body, origin, approvedBy, autoPrincipleId: null, expected }, env.clock.now())
    if (origin === 'human_edited' && approvedBy === null) yield* offerAfterDecision(draft, body)
    if (approvedBy !== null) yield* announceReview(yield* reviewersOf(draft), id)
    return yield* noteById(id, caller.member.id)
  })

/** Discards a draft with the person's reason; a discarded channel answer leaves its question unanswered. */
export const discardDraft = (
  caller: Caller,
  id: NoteId,
  reason: string | undefined,
): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller)) return yield* T.fail(Forbidden({ message: 'Only a person can discard a draft.' }))
    const { draft, approvedBy } = yield* draftToDecide(caller, id)
    const kept = reason?.trim() || null
    yield* run(
      sql`UPDATE notes SET decided_at = ${env.clock.now()}, discard_reason = ${kept}, discarded_by = ${approvedBy} WHERE id = ${id} AND status = 'draft'`,
    )
    yield* abandonDraft(draft)
    if (approvedBy === null) yield* offerAfterDecision(draft, null)
    else if (draft.in_reply_to !== null)
      yield* run(
        sql`UPDATE receipts SET drafting_at = NULL WHERE note_id = ${draft.in_reply_to} AND member_id = ${draft.author_id}`,
      )
    if (draft.in_reply_to !== null) yield* announceStatus(draft.in_reply_to)
    if (approvedBy !== null) yield* announceReview(yield* reviewersOf(draft), id)
    return yield* noteById(id, caller.member.id)
  })

const isAsShown = (draft: NoteRow, shown: DraftAsShown): boolean =>
  draft.body === shown.body &&
  draft.conversation_id === shown.conversationId &&
  isSameTags(tagsOf(draft), shown.tags)

/**
 * The draft a person decides: their own, or a channel's agent's they review, which records them as its
 * approver. Anyone else's is not found.
 */
const draftToDecide = (
  caller: Caller,
  id: NoteId,
): T.Task<{ readonly draft: NoteRow; readonly approvedBy: MemberId | null }, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const own = yield* first(sql`SELECT id FROM notes WHERE id = ${id} AND author_id = ${caller.member.id}`)
    if (own !== null) return { draft: yield* ownDraft(caller.member.id, id), approvedBy: null }
    const reviewed = yield* reviewedDraft(caller, id)
    return { draft: reviewed.draft, approvedBy: caller.member.id }
  })
