import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type ConversationId,
  Forbidden,
  type InboxItem,
  Invalid,
  type MemberId,
  NotFound,
  type Note,
  NoteId,
  type Origin,
} from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { containsIgnoringCase, insertIgnoringConflict, insertInto, sql } from '../sql/query.ts'
import {
  conversationFor,
  directConversationWith,
  participantsOf,
  participatedConversation,
  requireMayMessage,
} from './conversations.ts'
import { membersByIds } from './members.ts'
import { type NoteRow, hydrateNotes } from './note-rows.ts'

export interface DraftDestination {
  readonly conversationId?: ConversationId
  readonly to?: ReadonlyArray<MemberId>
  readonly inReplyTo?: NoteId
}

export interface DraftTarget extends DraftDestination {
  readonly body: string
}

export const createDraft = (caller: Caller, target: DraftTarget): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const authorId = caller.member.id
    const conversationId = yield* conversationForDraft(authorId, target)
    yield* requireRoomForAnotherDraft(authorId)
    const now = env.clock.now()
    const row: NoteRow = {
      id: NoteId.of(env.random.identifier()),
      conversation_id: conversationId,
      author_id: authorId,
      status: 'draft',
      body: target.body,
      in_reply_to: target.inReplyTo ?? null,
      origin: isHuman(caller) ? 'human' : 'agent',
      agent_name: isHuman(caller) ? null : caller.credential.name,
      credential_id: caller.credential.id,
      created_at: now,
      updated_at: now,
      sent_at: null,
    }
    yield* run(insertInto('notes', { ...row }))
    const draft = yield* noteById(row.id)
    yield* emit([authorId], { type: 'draft.saved', note: draft })
    if (row.in_reply_to !== null) yield* announceStatus(row.in_reply_to)
    return draft
  })

export const updateDraft = (
  caller: Caller,
  id: NoteId,
  body: string,
): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const draft = yield* ownDraft(caller.member.id, id)
    const origin = originAfterEdit(draft.origin, isHuman(caller), body !== draft.body)
    yield* run(
      sql`UPDATE notes SET body = ${body}, origin = ${origin}, updated_at = ${env.clock.now()} WHERE id = ${id} AND status = 'draft'`,
    )
    const updated = yield* noteById(id)
    yield* emit([caller.member.id], { type: 'draft.saved', note: updated })
    return updated
  })

export const sendDraft = (
  caller: Caller,
  id: NoteId,
  replacementBody: string | undefined,
): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller)) return yield* T.fail(Forbidden({ message: 'Only a person can approve a note.' }))
    const authorId = caller.member.id
    const draft = yield* ownDraft(authorId, id)
    const participants = yield* participantsOf(draft.conversation_id)
    const recipients = participants.filter((memberId) => memberId !== authorId)
    yield* requireMayMessageIn(authorId, draft.conversation_id)
    const body = replacementBody ?? draft.body
    const origin = originAfterEdit(draft.origin, true, body !== draft.body)
    const now = yield* nextSendTime(draft.conversation_id, env.clock.now())
    const sent = yield* run(
      sql`UPDATE notes SET status = 'sent', body = ${body}, origin = ${origin}, sent_at = ${now}, updated_at = ${now} WHERE id = ${id} AND status = 'draft'`,
    )
    if (sent === 0) return yield* T.fail(Conflict({ message: 'This draft was already sent or discarded.' }))
    for (const memberId of recipients)
      yield* run(insertInto('receipts', { note_id: id, member_id: memberId, delivered_at: now }))
    yield* run(sql`UPDATE conversations SET last_activity_at = ${now} WHERE id = ${draft.conversation_id}`)
    if (draft.in_reply_to !== null) yield* settleReply(authorId, draft.in_reply_to, now)
    const note = yield* noteById(id)
    yield* emit(participants, { type: 'note.sent', note })
    if (draft.in_reply_to !== null) yield* announceStatus(draft.in_reply_to)
    return note
  })

export const discardDraft = (caller: Caller, id: NoteId): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    if (!isHuman(caller)) return yield* T.fail(Forbidden({ message: 'Only a person can discard a draft.' }))
    const draft = yield* ownDraft(caller.member.id, id)
    yield* discard(draft)
    if (draft.in_reply_to !== null) yield* announceStatus(draft.in_reply_to)
    return yield* noteById(id)
  })

export const markRead = (caller: Caller, id: NoteId): T.Task<Note, NotFound, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* visibleNote(caller.member.id, id)
    const changed = yield* run(
      sql`UPDATE receipts SET read_at = ${env.clock.now()} WHERE note_id = ${id} AND member_id = ${caller.member.id} AND read_at IS NULL`,
    )
    if (changed > 0) yield* announceStatus(id)
    return yield* noteById(id)
  })

export const pickUp = (caller: Caller, id: NoteId): T.Task<Note, NotFound, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* visibleNote(caller.member.id, id)
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
    return yield* noteById(id)
  })

export const visibleNote = (viewerId: MemberId, id: NoteId): T.Task<Note, NotFound, RequestEnv> =>
  T.gen(function* () {
    const row = yield* first<NoteRow>(sql`
      SELECT n.* FROM notes n
      JOIN participants p ON p.conversation_id = n.conversation_id AND p.member_id = ${viewerId}
      WHERE n.id = ${id} AND (n.status = 'sent' OR n.author_id = ${viewerId})`)
    if (row === null) return yield* T.fail(NotFound({ message: 'No such note.' }))
    return (yield* hydrateNotes([row]))[0]!
  })

export const notesInConversation = (
  viewerId: MemberId,
  conversationId: ConversationId,
  page: { readonly before: number | null; readonly limit: number },
): T.Task<{ notes: Note[]; hasMore: boolean }, NotFound, RequestEnv> =>
  T.gen(function* () {
    yield* participatedConversation(viewerId, conversationId)
    const sentRows = yield* all<NoteRow>(sql`
      SELECT * FROM notes WHERE conversation_id = ${conversationId} AND status = 'sent'
      AND sent_at < ${page.before ?? Number.MAX_SAFE_INTEGER}
      ORDER BY sent_at DESC, id DESC LIMIT ${page.limit + 1}`)
    const ownDrafts =
      page.before === null
        ? yield* all<NoteRow>(sql`
            SELECT * FROM notes WHERE conversation_id = ${conversationId} AND status = 'draft'
            AND author_id = ${viewerId} ORDER BY created_at, id`)
        : []
    const notes = yield* hydrateNotes([...sentRows.slice(0, page.limit).reverse(), ...ownDrafts])
    return { notes, hasMore: sentRows.length > page.limit }
  })

export const draftsOf = (authorId: MemberId): T.Task<Note[], never, RequestEnv> =>
  T.gen(function* () {
    const rows = yield* all<NoteRow>(
      sql`SELECT * FROM notes WHERE author_id = ${authorId} AND status = 'draft' ORDER BY created_at, id`,
    )
    return yield* hydrateNotes(rows)
  })

export const notesAwaitingReply = (
  caller: Caller,
  onlyFresh: boolean,
): T.Task<InboxItem[], never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const viewerId = caller.member.id
    const notPickedUp = onlyFresh
      ? sql`AND NOT EXISTS (SELECT 1 FROM pickups k WHERE k.note_id = n.id AND k.credential_id = ${caller.credential.id})`
      : sql``
    const rows = yield* all<NoteRow>(sql`
      SELECT n.* FROM notes n JOIN receipts r ON r.note_id = n.id AND r.member_id = ${viewerId}
      WHERE n.status = 'sent' AND r.replied_at IS NULL AND n.sent_at > ${env.clock.now() - INBOX_WINDOW_MS}
      ${notPickedUp} ORDER BY n.sent_at, n.id LIMIT ${INBOX_LIMIT}`)
    const notes = yield* hydrateNotes(rows)
    const authors = yield* membersByIds(notes.map((note) => note.authorId))
    const items: InboxItem[] = []
    for (const note of notes) {
      const conversation = yield* T.result(conversationFor(viewerId, note.conversationId))
      const author = authors.get(note.authorId)
      if (conversation._tag === 'Ok' && author !== undefined)
        items.push({ note, author, conversation: conversation.value })
    }
    return items
  })

export const searchNotes = (
  viewerId: MemberId,
  needle: string,
  limit: number,
): T.Task<Note[], never, RequestEnv> =>
  T.gen(function* () {
    const rows = yield* all<NoteRow>(sql`
      SELECT n.* FROM notes n
      JOIN participants p ON p.conversation_id = n.conversation_id AND p.member_id = ${viewerId}
      WHERE (n.status = 'sent' OR (n.status = 'draft' AND n.author_id = ${viewerId}))
      AND ${containsIgnoringCase('n.body', needle)}
      ORDER BY n.created_at DESC LIMIT ${limit}`)
    return yield* hydrateNotes(rows)
  })

export const conversationForDraft = (
  authorId: MemberId,
  destination: DraftDestination,
): T.Task<ConversationId, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const conversationId = yield* resolveConversation(authorId, destination)
    yield* requireMayMessageIn(authorId, conversationId)
    return conversationId
  })

export type NoteFailure = NotFound | Forbidden | Conflict | Invalid

const MAX_OPEN_DRAFTS = 200
const INBOX_LIMIT = 50
const INBOX_WINDOW_MS = 30 * 24 * 60 * 60_000

const resolveConversation = (
  authorId: MemberId,
  target: DraftDestination,
): T.Task<ConversationId, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    if (target.inReplyTo !== undefined) {
      const original = yield* visibleNote(authorId, target.inReplyTo)
      if (original.status !== 'sent')
        return yield* T.fail(Invalid({ message: 'You can only reply to a sent note.' }))
      return original.conversationId
    }
    if (target.conversationId !== undefined)
      return (yield* participatedConversation(authorId, target.conversationId)).id
    if (target.to === undefined) return yield* T.fail(Invalid({ message: 'Say who the note is for.' }))
    if (target.to.length > 1)
      return yield* T.fail(Invalid({ message: 'Create a group conversation first, then draft into it.' }))
    return (yield* directConversationWith(authorId, target.to[0]!)).id
  })

const requireMayMessageIn = (
  authorId: MemberId,
  conversationId: ConversationId,
): T.Task<void, NotFound | Forbidden, RequestEnv> =>
  T.gen(function* () {
    const conversation = yield* participatedConversation(authorId, conversationId)
    if (conversation.kind !== 'dm') return
    const others = (yield* participantsOf(conversationId)).filter((memberId) => memberId !== authorId)
    yield* requireMayMessage(authorId, others)
  })

const requireRoomForAnotherDraft = (authorId: MemberId): T.Task<void, Conflict, RequestEnv> =>
  T.gen(function* () {
    const open = yield* first<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM notes WHERE author_id = ${authorId} AND status = 'draft'`,
    )
    if (Number(open?.total ?? 0) >= MAX_OPEN_DRAFTS)
      return yield* T.fail(
        Conflict({ message: 'Too many drafts are waiting for approval. Send or discard some first.' }),
      )
  })

const ownDraft = (authorId: MemberId, id: NoteId): T.Task<NoteRow, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const row = yield* first<NoteRow>(sql`SELECT * FROM notes WHERE id = ${id} AND author_id = ${authorId}`)
    if (row === null) return yield* T.fail(NotFound({ message: 'No such draft.' }))
    if (row.status !== 'draft')
      return yield* T.fail(Conflict({ message: 'This draft was already sent or discarded.' }))
    return row
  })

const nextSendTime = (conversationId: ConversationId, clockTime: number): T.Task<number, never, RequestEnv> =>
  T.map((latest: { sent_at: number | null } | null) => Math.max(clockTime, Number(latest?.sent_at ?? 0) + 1))(
    first(
      sql`SELECT MAX(sent_at) AS sent_at FROM notes WHERE conversation_id = ${conversationId} AND status = 'sent'`,
    ),
  )

const settleReply = (authorId: MemberId, repliedTo: NoteId, now: number): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    yield* run(
      sql`UPDATE receipts SET replied_at = ${now}, read_at = COALESCE(read_at, ${now}) WHERE note_id = ${repliedTo} AND member_id = ${authorId}`,
    )
    const alternatives = yield* all<NoteRow>(
      sql`SELECT * FROM notes WHERE in_reply_to = ${repliedTo} AND author_id = ${authorId} AND status = 'draft'`,
    )
    for (const alternative of alternatives) yield* discard(alternative)
  })

const discard = (draft: NoteRow): T.Task<void, never, RequestEnv> =>
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

const announceStatus = (id: NoteId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const note = yield* noteById(id)
    if (note.status !== 'sent') return
    const participants = yield* participantsOf(note.conversationId)
    yield* emit(participants, {
      type: 'note.status',
      noteId: note.id,
      conversationId: note.conversationId,
      receipts: note.receipts,
    })
  })

const noteById = (id: NoteId): T.Task<Note, never, RequestEnv> =>
  T.gen(function* () {
    const rows = yield* all<NoteRow>(sql`SELECT * FROM notes WHERE id = ${id}`)
    return (yield* hydrateNotes(rows))[0]!
  })

const originAfterEdit = (origin: Origin, editorIsHuman: boolean, bodyChanged: boolean): Origin =>
  !bodyChanged
    ? origin
    : origin === 'agent' && editorIsHuman
      ? 'human_edited'
      : origin === 'human' && !editorIsHuman
        ? 'human_edited'
        : origin
