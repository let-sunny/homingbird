import { Task as T } from '@homingbird/kernel'
import type { DebateId, Note, NoteId } from '@homingbird/protocol'
import type { Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { markRoomAnswered, requireRoomToAnswer } from './debate-suggestions.ts'
import {
  type DraftChange,
  type DraftTarget,
  type NoteFailure,
  createDraft,
  ownDraft,
  updateDraft,
} from './drafts.ts'

/** The draft carries the room, so a saved answer never sends it: it waits for its person (rules 1, 9). */
export const draftAnswerFromRoom = (
  caller: Caller,
  debateId: DebateId,
  target: DraftTarget,
): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const suggestion = yield* requireRoomToAnswer(caller, debateId, target.inReplyTo ?? null)
    const draft = yield* createDraft(caller, { ...target, fromDebate: debateId })
    yield* markRoomAnswered(suggestion)
    return draft
  })

export const reviseAnswerFromRoom = (
  caller: Caller,
  id: NoteId,
  debateId: DebateId,
  change: DraftChange,
): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const draft = yield* ownDraft(caller.member.id, id)
    const suggestion = yield* requireRoomToAnswer(caller, debateId, draft.in_reply_to)
    const revised = yield* updateDraft(caller, id, { ...change, fromDebate: debateId })
    yield* markRoomAnswered(suggestion)
    return revised
  })
