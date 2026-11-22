import { Task as T } from '@homingbird/kernel'
import { type Note, type PrincipleId, isPerson, isSavedAnswerText } from '@homingbird/protocol'
import { type AppEnv, type Caller, isHuman } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { recordAudit } from './audit.ts'
import { autoSendPlacesAmong } from './auto-send-settings.ts'
import { requireMayMessageIn } from './conversations.ts'
import { deliverDraft } from './delivery.ts'
import type { NoteFailure } from './drafts.ts'
import type { NoteRow } from './note-rows.ts'
import { noteById } from './note-status.ts'
import { featureIsOn } from './settings.ts'

/** Sends a draft that is exactly a saved answer its person switched on there (rule 1); else null. */
export const sendIfSavedAnswer = (
  caller: Caller,
  draft: NoteRow,
): T.Task<Note | null, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (isHuman(caller) || !isPerson(caller.member) || draft.debate_id !== null) return null
    if (!(yield* featureIsOn('autoSend')) || !(yield* featureIsOn('teaching'))) return null
    const answer = yield* answerSending(draft)
    if (answer === null) return null
    const allowed = yield* T.exit(requireMayMessageIn(draft.author_id, draft.conversation_id))
    if (allowed._tag === 'Err') return null
    const expected = { body: draft.body, conversationId: draft.conversation_id }
    const decision = {
      body: draft.body,
      origin: draft.origin,
      approvedBy: draft.author_id,
      autoPrincipleId: answer,
      expected,
    }
    yield* deliverDraft(draft, decision, env.clock.now())
    yield* recordAudit('note.auto_sent', {
      caller,
      targetId: draft.id,
      detail: { conversationId: draft.conversation_id, principleId: answer },
    })
    return yield* noteById(draft.id, draft.author_id)
  })

/** The answer that sends this draft, in the person's order when two match; none if the place is closed. */
const answerSending = (draft: NoteRow): T.Task<PrincipleId | null, never, AppEnv> =>
  T.gen(function* () {
    const candidates = yield* all<{ id: PrincipleId; rule: string }>(sql`
      SELECT p.id, p.rule FROM principles p
      JOIN principle_applications a ON a.principle_id = p.id AND a.note_id = ${draft.id}
      JOIN principle_auto_send_places s ON s.principle_id = p.id AND s.conversation_id = ${draft.conversation_id}
      WHERE p.member_id = ${draft.author_id} AND p.kind = 'answer' AND p.enabled = 1 AND p.auto_send = 1
      ORDER BY p.position, p.created_at, p.id`)
    const match = candidates.find((candidate) => isSavedAnswerText(draft.body, candidate.rule))
    if (match === undefined) return null
    const still = yield* autoSendPlacesAmong(draft.author_id, [draft.conversation_id])
    return still.length === 1 ? match.id : null
  })
