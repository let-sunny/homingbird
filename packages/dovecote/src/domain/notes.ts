import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type ConversationId,
  type DebateId,
  type DeskSession,
  Forbidden,
  type InboxItem,
  Invalid,
  type MemberId,
  NotFound,
  type Note,
  NoteId,
  type Notice,
  type Origin,
  agentLabelOf,
} from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { containsIgnoringCase, insertIgnoringConflict, insertInto, sql } from '../sql/query.ts'
import { abandonDraft } from './abandoned-drafts.ts'
import { helpersOf } from './channel-rows.ts'
import { channelRoomFor, roomForMovedQuestion } from './channels.ts'
import {
  conversationFor,
  directConversationWith,
  participantsOf,
  participatedConversation,
  requireMayMessage,
} from './conversations.ts'
import { membersByIds } from './members.ts'
import { type NoteRow, hydrateNotes } from './note-rows.ts'
import { keepNotice, moveNotices, noticesFor } from './notices.ts'
import { offerAfterDecision, recordApplications } from './principles.ts'

export interface DraftDestination {
  readonly conversationId?: ConversationId
  readonly to?: ReadonlyArray<MemberId>
  readonly channel?: string
  readonly inReplyTo?: NoteId
}

export interface DraftTarget extends DraftDestination {
  readonly body: string
  /** The debate room whose approved result this draft carries; its agents wrote it, so it is the agents' note. */
  readonly fromDebate?: DebateId
  readonly basis?: string
  readonly client?: string
  readonly model?: string
  readonly session?: DeskSession
}

export interface DraftChange {
  readonly body?: string
  readonly channel?: string
  readonly basis?: string
  readonly model?: string
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
      origin: isHuman(caller) && target.fromDebate === undefined ? 'human' : 'agent',
      agent_name: isHuman(caller) ? null : caller.credential.name,
      credential_id: caller.credential.id,
      created_at: now,
      updated_at: now,
      sent_at: null,
      basis: target.basis?.trim() || null,
      seen_at: null,
      decided_at: null,
      agent_body: isHuman(caller) ? null : target.body,
      agent_client: isHuman(caller) ? null : (target.client?.trim() ?? (yield* clientOf(caller))),
      agent_model: isHuman(caller) ? null : (target.model?.trim() ?? null),
      session_minutes: isHuman(caller) ? null : (target.session?.ageMinutes ?? null),
      context_percent: isHuman(caller) ? null : (target.session?.contextPercent ?? null),
      debate_id: target.fromDebate ?? null,
    }
    yield* run(insertInto('notes', { ...row }))
    if (!isHuman(caller)) yield* recordApplications(authorId, row.id, row.basis)
    const draft = yield* noteById(row.id, authorId)
    yield* emit([authorId], { type: 'draft.saved', note: draft })
    if (row.in_reply_to !== null) yield* announceStatus(row.in_reply_to)
    return draft
  })

export const updateDraft = (
  caller: Caller,
  id: NoteId,
  change: DraftChange,
): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const draft = yield* ownDraft(caller.member.id, id)
    const body = change.body ?? draft.body
    const conversationId =
      change.channel === undefined ? draft.conversation_id : yield* readdressedRoom(draft, change.channel)
    const origin = originAfterEdit(draft.origin, isHuman(caller), body !== draft.body)
    const basis = change.basis === undefined ? draft.basis : change.basis.trim() || null
    const agentBody = isHuman(caller) ? draft.agent_body : body
    const model = isHuman(caller) || change.model === undefined ? draft.agent_model : change.model.trim()
    yield* run(
      sql`UPDATE notes SET body = ${body}, conversation_id = ${conversationId}, origin = ${origin}, basis = ${basis}, agent_body = ${agentBody}, agent_model = ${model}, updated_at = ${env.clock.now()} WHERE id = ${id} AND status = 'draft'`,
    )
    if (!isHuman(caller)) yield* recordApplications(caller.member.id, id, basis)
    const updated = yield* noteById(id, caller.member.id)
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
    const recipients = yield* recipientsOf(draft, participants)
    yield* requireMayMessageIn(authorId, draft.conversation_id)
    const body = replacementBody ?? draft.body
    const origin = originAfterEdit(draft.origin, true, body !== draft.body)
    const decidedAt = env.clock.now()
    const now = yield* nextSendTime(draft.conversation_id, decidedAt)
    const sent = yield* run(
      sql`UPDATE notes SET status = 'sent', body = ${body}, origin = ${origin}, sent_at = ${now}, updated_at = ${now}, decided_at = ${decidedAt} WHERE id = ${id} AND status = 'draft'`,
    )
    if (sent === 0) return yield* T.fail(Conflict({ message: 'This draft was already sent or discarded.' }))
    for (const memberId of recipients)
      yield* run(insertInto('receipts', { note_id: id, member_id: memberId, delivered_at: now }))
    yield* run(sql`UPDATE conversations SET last_activity_at = ${now} WHERE id = ${draft.conversation_id}`)
    if (draft.in_reply_to !== null) yield* settleReply(authorId, draft.in_reply_to, now)
    if (origin === 'human_edited') yield* offerAfterDecision(draft, body)
    yield* emit(participants, { type: 'note.sent', note: yield* noteById(id, null) })
    if (draft.in_reply_to !== null) yield* announceStatus(draft.in_reply_to)
    return yield* noteById(id, authorId)
  })

export const discardDraft = (caller: Caller, id: NoteId): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller)) return yield* T.fail(Forbidden({ message: 'Only a person can discard a draft.' }))
    const draft = yield* ownDraft(caller.member.id, id)
    yield* run(sql`UPDATE notes SET decided_at = ${env.clock.now()} WHERE id = ${id} AND status = 'draft'`)
    yield* abandonDraft(draft)
    yield* offerAfterDecision(draft, null)
    if (draft.in_reply_to !== null) yield* announceStatus(draft.in_reply_to)
    return yield* noteById(id, caller.member.id)
  })

/** Records when a draft was first shown to its author in a visible page; later calls change nothing. */
export const markDraftSeen = (caller: Caller, id: NoteId): T.Task<void, NotFound, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const own = yield* first(sql`SELECT id FROM notes WHERE id = ${id} AND author_id = ${caller.member.id}`)
    if (own === null) return yield* T.fail(NotFound({ message: 'No such draft.' }))
    yield* run(
      sql`UPDATE notes SET seen_at = ${env.clock.now()} WHERE id = ${id} AND status = 'draft' AND seen_at IS NULL`,
    )
  })

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
    for (const memberId of (yield* helpersOf(to)).filter((helperId) => helperId !== note.authorId))
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

export const visibleNote = (viewerId: MemberId, id: NoteId): T.Task<Note, NotFound, RequestEnv> =>
  T.gen(function* () {
    const row = yield* first<NoteRow>(sql`
      SELECT n.* FROM notes n
      JOIN participants p ON p.conversation_id = n.conversation_id AND p.member_id = ${viewerId}
      WHERE n.id = ${id} AND (n.status = 'sent' OR n.author_id = ${viewerId})`)
    if (row === null) return yield* T.fail(NotFound({ message: 'No such note.' }))
    return (yield* hydrateNotes([row], viewerId))[0]!
  })

export const notesInConversation = (
  viewerId: MemberId,
  conversationId: ConversationId,
  page: { readonly before: number | null; readonly limit: number },
): T.Task<{ notes: Note[]; hasMore: boolean; notices: Notice[] }, NotFound, RequestEnv> =>
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
    const notes = yield* hydrateNotes([...sentRows.slice(0, page.limit).reverse(), ...ownDrafts], viewerId)
    const notices = page.before === null ? yield* noticesFor(viewerId, conversationId) : []
    return { notes, hasMore: sentRows.length > page.limit, notices }
  })

export const draftsOf = (authorId: MemberId): T.Task<Note[], never, RequestEnv> =>
  T.gen(function* () {
    const rows = yield* all<NoteRow>(
      sql`SELECT * FROM notes WHERE author_id = ${authorId} AND status = 'draft' ORDER BY created_at, id`,
    )
    return yield* hydrateNotes(rows, authorId)
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
      AND NOT EXISTS (
        SELECT 1 FROM notes a JOIN conversations c ON c.id = a.conversation_id
        WHERE a.in_reply_to = n.id AND a.status = 'sent' AND c.kind = 'channel')
      ${notPickedUp} ORDER BY n.sent_at, n.id LIMIT ${INBOX_LIMIT}`)
    const notes = yield* hydrateNotes(rows, viewerId)
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
    return yield* hydrateNotes(rows, viewerId)
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
const ARCHIVED = Conflict({
  message:
    'No reply is possible: this channel was archived. It can still be read, but nothing more can be written in it, here or in the web client.',
})
const INBOX_LIMIT = 50
const INBOX_WINDOW_MS = 30 * 24 * 60 * 60_000

/**
 * The program a credential signed in from, as its registration named it: a fallback when the
 * integration names none, cleaned like every other label because the registrant chose the name.
 */
const clientOf = (caller: Caller): T.Task<string | null, never, RequestEnv> =>
  T.map((row: { client: string } | null) => agentLabelOf(row?.client))(
    first<{ client: string }>(sql`SELECT client FROM credentials WHERE id = ${caller.credential.id}`),
  )

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
    if (target.channel !== undefined) return yield* channelRoomFor(authorId, target.channel)
    if (target.to === undefined) return yield* T.fail(Invalid({ message: 'Say who the note is for.' }))
    if (target.to.length > 1)
      return yield* T.fail(Invalid({ message: 'Create a group conversation first, then draft into it.' }))
    return (yield* directConversationWith(authorId, target.to[0]!)).id
  })

const requireMayMessageIn = (
  authorId: MemberId,
  conversationId: ConversationId,
): T.Task<void, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    const conversation = yield* participatedConversation(authorId, conversationId)
    if ((conversation.archived_at ?? null) !== null) return yield* T.fail(ARCHIVED)
    if (conversation.kind !== 'direct') return
    const others = (yield* participantsOf(conversationId)).filter((memberId) => memberId !== authorId)
    yield* requireMayMessage(authorId, others)
  })

const recipientsOf = (
  draft: NoteRow,
  participants: ReadonlyArray<MemberId>,
): T.Task<MemberId[], never, RequestEnv> =>
  T.gen(function* () {
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
    const helpers = new Set(yield* helpersOf(draft.conversation_id))
    return others.filter((memberId) => helpers.has(memberId))
  })

const readdressedRoom = (draft: NoteRow, channel: string): T.Task<ConversationId, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const room = yield* first<{ kind: string }>(
      sql`SELECT kind FROM conversations WHERE id = ${draft.conversation_id}`,
    )
    if (room?.kind !== 'channel' || draft.in_reply_to !== null)
      return yield* T.fail(
        Conflict({ message: 'Only a question drafted to a channel can move to another channel.' }),
      )
    return yield* channelRoomFor(draft.author_id, channel)
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
    for (const alternative of alternatives) yield* abandonDraft(alternative)
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

const noteById = (id: NoteId, viewerId: MemberId | null): T.Task<Note, never, RequestEnv> =>
  T.gen(function* () {
    const rows = yield* all<NoteRow>(sql`SELECT * FROM notes WHERE id = ${id}`)
    return (yield* hydrateNotes(rows, viewerId))[0]!
  })

const originAfterEdit = (origin: Origin, editorIsHuman: boolean, bodyChanged: boolean): Origin =>
  !bodyChanged
    ? origin
    : origin === 'agent' && editorIsHuman
      ? 'human_edited'
      : origin === 'human' && !editorIsHuman
        ? 'human_edited'
        : origin
