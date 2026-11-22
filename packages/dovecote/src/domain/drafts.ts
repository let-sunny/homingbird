import { Task as T } from '@homingbird/kernel'
import {
  AGENT_OPEN_DRAFTS_MAX,
  Conflict,
  type ConversationId,
  type DebateId,
  type DeskSession,
  type DraftSource,
  Forbidden,
  Invalid,
  type MemberId,
  NO_REVIEWER_MESSAGE,
  NotFound,
  type Note,
  NoteId,
  type Origin,
  agentLabelOf,
  isPerson,
  possibleReviewers,
} from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import { sendIfSavedAnswer } from './auto-send.ts'
import { agentAnsweringIn, channelAgentOf, channelOfAgentRoom, managersOf } from './channel-rows.ts'
import { channelRoomFor } from './channels.ts'
import { directConversationWith, participatedConversation, requireMayMessageIn } from './conversations.ts'
import { announcePreview } from './draft-previews.ts'
import { storedSources } from './draft-sources.ts'
import type { NoteRow } from './note-rows.ts'
import { announceStatus, noteById } from './note-status.ts'
import { storedTags } from './note-tags.ts'
import { visibleNote } from './notes.ts'
import { recordApplications } from './principle-applications.ts'
import { announceReview } from './review-events.ts'
import { askersOf, reviewFor, reviewersOf } from './reviews.ts'

export interface DraftDestination {
  readonly conversationId?: ConversationId
  readonly to?: ReadonlyArray<MemberId>
  readonly channel?: string
  readonly inReplyTo?: NoteId
}

export interface DraftTarget extends DraftDestination {
  readonly body: string
  /** In a group message, the people whose agents it asks; a person approves them with the note. */
  readonly tags?: ReadonlyArray<MemberId>
  /** The debate room whose approved result this draft carries; its agents wrote it, so it is the agents' note. */
  readonly fromDebate?: DebateId
  readonly basis?: string
  readonly sources?: ReadonlyArray<DraftSource>
  readonly client?: string
  readonly model?: string
  readonly session?: DeskSession
}

export interface DraftChange {
  readonly body?: string
  readonly channel?: string
  readonly tags?: ReadonlyArray<MemberId>
  readonly basis?: string
  readonly sources?: ReadonlyArray<DraftSource>
  readonly model?: string
}

export type NoteFailure = NotFound | Forbidden | Conflict | Invalid

export const createDraft = (caller: Caller, target: DraftTarget): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const authorId = caller.member.id
    yield* requireAgentMayAnswer(caller, target)
    const conversationId = yield* conversationForDraft(authorId, target)
    yield* requireNoChannelAgentAnswers(caller, conversationId, target)
    yield* requireRoomForAnotherDraft(authorId)
    const sources = yield* storedSources(authorId, target.sources)
    const inReplyTo = target.inReplyTo ?? null
    const tags = yield* storedTags({ authorId, conversationId, inReplyTo, tags: target.tags })
    const now = env.clock.now()
    const row: NoteRow = {
      id: NoteId.of(env.random.identifier()),
      conversation_id: conversationId,
      author_id: authorId,
      status: 'draft',
      body: target.body,
      in_reply_to: inReplyTo,
      tags,
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
      approved_by: null,
      sources,
      discard_reason: null,
      discarded_by: null,
    }
    yield* run(insertInto('notes', { ...row }))
    if (!isHuman(caller)) yield* recordApplications(authorId, row.id, row.basis)
    const sent = yield* sendIfSavedAnswer(caller, row)
    if (sent !== null) return sent
    const draft = yield* noteById(row.id, authorId)
    yield* emit([authorId], { type: 'draft.saved', note: draft })
    yield* announcePreview(row)
    if (row.in_reply_to !== null) yield* announceStatus(row.in_reply_to)
    if (!isPerson(caller.member))
      yield* announceReview(yield* reviewersOf(row), row.id, { isNewAnswer: true })
    return draft
  })

export const updateDraft = (
  caller: Caller,
  id: NoteId,
  change: DraftChange,
): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isPerson(caller.member) && change.channel !== undefined)
      return yield* T.fail(Forbidden({ message: AGENT_ANSWERS_ONLY }))
    const draft = yield* ownDraft(caller.member.id, id)
    const body = change.body ?? draft.body
    const conversationId =
      change.channel === undefined ? draft.conversation_id : yield* readdressedRoom(draft, change.channel)
    const origin = originAfterEdit(draft.origin, isHuman(caller), body !== draft.body)
    const basis = change.basis === undefined ? draft.basis : change.basis.trim() || null
    const sources =
      change.sources === undefined ? draft.sources : yield* storedSources(caller.member.id, change.sources)
    const agentBody = isHuman(caller) ? draft.agent_body : body
    const model = isHuman(caller) || change.model === undefined ? draft.agent_model : change.model.trim()
    const tags =
      change.tags === undefined
        ? (draft.tags ?? null)
        : yield* storedTags({
            authorId: caller.member.id,
            conversationId,
            inReplyTo: draft.in_reply_to,
            tags: change.tags,
          })
    yield* run(
      sql`UPDATE notes SET body = ${body}, conversation_id = ${conversationId}, tags = ${tags}, origin = ${origin}, basis = ${basis}, sources = ${sources}, agent_body = ${agentBody}, agent_model = ${model}, updated_at = ${env.clock.now()} WHERE id = ${id} AND status = 'draft'`,
    )
    if (!isHuman(caller)) yield* recordApplications(caller.member.id, id, basis)
    const sent = yield* sendIfSavedAnswer(caller, yield* ownDraft(caller.member.id, id))
    if (sent !== null) return sent
    const updated = yield* noteById(id, caller.member.id)
    yield* emit([caller.member.id], { type: 'draft.saved', note: updated })
    yield* announcePreview({ ...draft, conversation_id: conversationId })
    if (conversationId !== draft.conversation_id) yield* announcePreview(draft)
    if (!isPerson(caller.member)) yield* announceReview(yield* reviewersOf(draft), id)
    return updated
  })

/**
 * Records when a draft was first shown in a visible page to who decides it: its author, or a manager
 * who reviews a channel's agent's answer. Later calls change nothing.
 */
export const markDraftSeen = (caller: Caller, id: NoteId): T.Task<void, NotFound, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const own = yield* first(sql`SELECT id FROM notes WHERE id = ${id} AND author_id = ${caller.member.id}`)
    if (own === null) yield* reviewFor(caller, id)
    yield* run(
      sql`UPDATE notes SET seen_at = ${env.clock.now()} WHERE id = ${id} AND status = 'draft' AND seen_at IS NULL`,
    )
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

export const ownDraft = (authorId: MemberId, id: NoteId): T.Task<NoteRow, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const row = yield* first<NoteRow>(sql`SELECT * FROM notes WHERE id = ${id} AND author_id = ${authorId}`)
    if (row === null) return yield* T.fail(NotFound({ message: 'No such draft.' }))
    if (row.status !== 'draft')
      return yield* T.fail(Conflict({ message: 'This draft was already sent or discarded.' }))
    return row
  })

export const originAfterEdit = (origin: Origin, editorIsHuman: boolean, bodyChanged: boolean): Origin =>
  !bodyChanged
    ? origin
    : origin === 'agent' && editorIsHuman
      ? 'human_edited'
      : origin === 'human' && !editorIsHuman
        ? 'human_edited'
        : origin

const MAX_OPEN_DRAFTS = 200

const AGENT_ANSWERS_ONLY = 'A channel’s agent only answers questions asked in its channel.'

/**
 * A channel's agent writes only an answer: to a note someone else sent in its channel's room or in one of
 * its private questions, one waiting answer per question, a bounded number in all, and only when a
 * manager other than the asker could send it. It opens no conversation and joins no room.
 */
const requireAgentMayAnswer = (caller: Caller, target: DraftTarget): T.Task<void, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    if (isPerson(caller.member)) return
    const agentId = caller.member.id
    if (target.inReplyTo === undefined || target.to !== undefined || target.channel !== undefined)
      return yield* T.fail(Forbidden({ message: AGENT_ANSWERS_ONLY }))
    const question = yield* visibleNote(agentId, target.inReplyTo)
    const channel = yield* channelOfAgentRoom(question.conversationId)
    if (
      question.status !== 'sent' ||
      question.authorId === agentId ||
      channel === null ||
      (yield* channelAgentOf(channel))?.id !== agentId
    )
      return yield* T.fail(Forbidden({ message: AGENT_ANSWERS_ONLY }))
    const waiting = yield* first(
      sql`SELECT id FROM notes WHERE in_reply_to = ${question.id} AND author_id = ${agentId} AND status = 'draft'`,
    )
    if (waiting !== null)
      return yield* T.fail(
        Conflict({ message: 'An answer to this question is already waiting for approval.' }),
      )
    const open = yield* first<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM notes WHERE author_id = ${agentId} AND status = 'draft'`,
    )
    if (Number(open?.total ?? 0) >= AGENT_OPEN_DRAFTS_MAX)
      return yield* T.fail(
        Conflict({ message: 'Too many answers are waiting for approval. The managers decide some first.' }),
      )
    const askers = yield* askersOf({ conversation_id: question.conversationId, in_reply_to: question.id })
    if (possibleReviewers(yield* managersOf(channel), askers).length === 0)
      return yield* T.fail(Conflict({ message: NO_REVIEWER_MESSAGE }))
  })

/**
 * In a channel whose own agent answers, a person's agent drafts no answer to someone else's question:
 * that agent drafts it and the channel's managers review it. The person still replies themself.
 */
const requireNoChannelAgentAnswers = (
  caller: Caller,
  conversationId: ConversationId,
  target: DraftTarget,
): T.Task<void, Conflict, RequestEnv> =>
  T.gen(function* () {
    if (isHuman(caller) || !isPerson(caller.member) || target.inReplyTo === undefined) return
    if ((yield* agentAnsweringIn(conversationId)) === null) return
    const asker = yield* first<{ id: MemberId; kind: string }>(sql`
      SELECT m.id, m.kind FROM notes n JOIN members m ON m.id = n.author_id WHERE n.id = ${target.inReplyTo}`)
    if (asker?.id === caller.member.id || asker?.kind === 'channel_agent') return
    return yield* T.fail(Conflict({ message: CHANNEL_AGENT_ANSWERS }))
  })

const CHANNEL_AGENT_ANSWERS =
  'This channel has its own agent: it drafts the answers to questions here, and the channel’s managers review them. Your agent does not draft one.'

/**
 * The program a credential signed in from, as its registration named it: a fallback when the
 * integration names none, cleaned like every other label because the registrant chose the name.
 */
const clientOf = (caller: Caller): T.Task<string | null, never, RequestEnv> =>
  T.map((row: { client: string } | null) => agentLabelOf(row?.client))(
    first<{ client: string }>(sql`SELECT client FROM credentials WHERE id = ${caller.credential.id}`),
  )

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
