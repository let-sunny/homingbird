import { Task as T } from '@homingbird/kernel'
import { Conflict, type NotFound, type Note, type NoteId } from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, sql } from '../sql/query.ts'
import { announceStatus, noteById } from './note-status.ts'
import { visibleNote } from './notes.ts'
import { keepNotice } from './notices.ts'

export const markRead = (caller: Caller, id: NoteId): T.Task<Note, NotFound, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* visibleNote(caller.member.id, id)
    const changed = yield* run(
      sql`UPDATE receipts SET read_at = ${env.clock.now()} WHERE note_id = ${id} AND member_id = ${caller.member.id} AND read_at IS NULL`,
    )
    if (changed > 0) yield* announceStatus(id)
    return yield* noteById(id, caller.member.id)
  })

export const pickUp = (caller: Caller, id: NoteId): T.Task<Note, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* visibleNote(caller.member.id, id)
    if (!isHuman(caller)) yield* requireAsked(caller, id)
    const now = env.clock.now()
    const changed = yield* run(
      sql`UPDATE receipts SET drafting_at = ${now} WHERE note_id = ${id} AND member_id = ${caller.member.id} AND replied_at IS NULL`,
    )
    yield* run(
      insertIgnoringConflict(yield* dialect, 'pickups', {
        note_id: id,
        credential_id: caller.credential.id,
        picked_at: now,
      }),
    )
    if (changed > 0) yield* announceStatus(id)
    return yield* noteById(id, caller.member.id)
  })

export const release = (
  caller: Caller,
  id: NoteId,
  reason: string | undefined,
): T.Task<Note, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const note = yield* visibleNote(caller.member.id, id)
    const drafted = yield* first(
      sql`SELECT id FROM notes WHERE in_reply_to = ${id} AND author_id = ${caller.member.id} AND status = 'draft'`,
    )
    if (drafted !== null)
      return yield* T.fail(
        Conflict({ message: 'A reply draft to this note is waiting for approval; discard it instead.' }),
      )
    const changed = yield* run(
      sql`UPDATE receipts SET drafting_at = NULL WHERE note_id = ${id} AND member_id = ${caller.member.id} AND drafting_at IS NOT NULL`,
    )
    if (changed > 0) yield* announceStatus(id)
    if (!isHuman(caller)) yield* recordSkip(caller, note, reason?.trim() || null)
    yield* keepNotice({
      memberId: caller.member.id,
      kind: 'released',
      noteId: id,
      conversationId: note.conversationId,
      reason: reason?.trim() || null,
      agentName: isHuman(caller) ? null : caller.credential.name,
      channel: null,
    })
    yield* emit([caller.member.id], {
      type: 'note.released',
      noteId: id,
      conversationId: note.conversationId,
      reason: reason?.trim() || null,
      agentName: isHuman(caller) ? null : caller.credential.name,
    })
    return yield* noteById(id, caller.member.id)
  })

/** An agent picks up only a note that asks it: one tagging other people is its person's to read. */
const requireAsked = (caller: Caller, id: NoteId): T.Task<void, Conflict, RequestEnv> =>
  T.gen(function* () {
    const receipt = yield* first<{ asked: number | null }>(
      sql`SELECT asked FROM receipts WHERE note_id = ${id} AND member_id = ${caller.member.id}`,
    )
    if (receipt !== null && receipt.asked !== null && Number(receipt.asked) === 0)
      return yield* T.fail(Conflict({ message: NOT_ASKED }))
  })

export const NOT_ASKED = 'This note tags other people, so their agents answer it, not yours.'

const recordSkip = (caller: Caller, note: Note, reason: string | null): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* run(
      insertIgnoringConflict(yield* dialect, 'releases', {
        note_id: note.id,
        credential_id: caller.credential.id,
        member_id: caller.member.id,
        conversation_id: note.conversationId,
        reason,
        created_at: env.clock.now(),
      }),
    )
  })
