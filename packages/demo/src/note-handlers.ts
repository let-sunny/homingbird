import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  Conflict,
  DRAFT_CHANGED,
  Forbidden,
  type MemberId,
  NotFound,
  type Note,
  type NoteId,
  isSameTags,
  mayRecall,
  questionTerms,
  rankEarlierAnswers,
  tagsAsked,
} from '@homingbird/protocol'
import { answerLater } from './colleagues.ts'
import { type Handlers, found } from './handlers.ts'
import { offerAfterDecision } from './offers.ts'
import { cancelDraftRequest, openDraftRequests, requestDraft } from './own-agent.ts'
import {
  conversationAsSeen,
  conversationsOf,
  isParticipant,
  mayRead,
  notesSeenIn,
  reviewOf,
} from './reads.ts'
import { destinationOf, roomOf, roomWith } from './rooms.ts'
import { announceStatus, changeNote, reviewersOf, saveDraft, sendDraft } from './sending.ts'
import type { ConversationRecord, Records } from './world.ts'
import type { World } from './world.ts'

/** Conversations, notes and drafts: what a person reads, writes, sends and discards. */
export const noteHandlers = (world: World): Handlers => ({
  'conversations.list': (_, viewerId) =>
    T.sync(() => ({ conversations: conversationsOf(world.records(), viewerId) })),
  'conversations.get': ({ params }, viewerId) =>
    T.map((room: ConversationRecord) => conversationAsSeen(world.records(), viewerId, room))(
      roomOf(world.records(), viewerId, params.id),
    ),
  'conversations.create': ({ body }, viewerId) =>
    T.sync(() => {
      const room = roomWith(world, viewerId, body.participantIds, body.title ?? null)
      return conversationAsSeen(world.records(), viewerId, room)
    }),
  'conversations.mute': ({ params }, viewerId) => muting(world, viewerId, params.id, true),
  'conversations.unmute': ({ params }, viewerId) => muting(world, viewerId, params.id, false),
  'conversations.hide': ({ params }, viewerId) => hiding(world, viewerId, params.id, true),
  'conversations.unhide': ({ params }, viewerId) => hiding(world, viewerId, params.id, false),
  'conversations.leave': ({ params }, viewerId) =>
    T.gen(function* () {
      const room = yield* roomOf(world.records(), viewerId, params.id)
      if (room.kind !== 'group' || room.privateQuestionOf !== undefined)
        return yield* T.fail(Forbidden({ message: ONLY_GROUPS_LEFT }))
      world.update((records) => ({
        ...records,
        conversations: records.conversations.map((each) =>
          each.id === room.id
            ? { ...each, participantIds: each.participantIds.filter((id) => id !== viewerId) }
            : each,
        ),
      }))
      world.emit(room.participantIds, {
        type: 'conversation.left',
        conversationId: room.id,
        memberId: viewerId,
      })
      return {}
    }),
  'conversations.notes': ({ params, query }, viewerId) =>
    T.map(() => {
      const before = query.before === undefined ? null : Number(query.before)
      const notes = notesSeenIn(world.records(), viewerId, params.id).filter(
        (note) => before === null || (note.status === 'sent' && (note.sentAt ?? 0) < before),
      )
      const notices =
        before === null
          ? world
              .records()
              .notices.filter(
                (kept) => kept.memberId === viewerId && kept.notice.conversationId === params.id,
              )
              .map((kept) => kept.notice)
          : []
      return { notes, hasMore: false, notices }
    })(roomOf(world.records(), viewerId, params.id)),
  'notes.get': ({ params }, viewerId) => readableNote(world.records(), viewerId, params.id),
  'notes.recall': ({ params }, viewerId) =>
    T.gen(function* () {
      const note = yield* readableNote(world.records(), viewerId, params.id)
      if (note.authorId !== viewerId || note.status === 'draft')
        return yield* T.fail(NotFound({ message: 'No such note.' }))
      if (!mayRecall(note, viewerId, world.clock.now()))
        return yield* T.fail(Conflict({ message: RECALL_REFUSED }))
      const recalled = changeNote(world, note.id, (current) => ({
        ...current,
        status: 'withdrawn',
        receipts: [],
        updatedAt: world.clock.now(),
      }))
      const room = world.records().conversations.find((each) => each.id === note.conversationId)
      world.emit(room?.participantIds ?? [viewerId], {
        type: 'note.withdrawn',
        noteId: note.id,
        conversationId: note.conversationId,
      })
      return recalled
    }),
  'notes.read': ({ params }, viewerId) =>
    T.map((note: Note) => {
      if (!note.receipts.some((receipt) => receipt.memberId === viewerId && receipt.readAt === null))
        return note
      const now = world.clock.now()
      const read = changeNote(world, note.id, (current) => ({
        ...current,
        receipts: current.receipts.map((receipt) =>
          receipt.memberId === viewerId && receipt.readAt === null
            ? { ...receipt, readAt: now, state: receipt.state === 'delivered' ? 'read' : receipt.state }
            : receipt,
        ),
      }))
      announceStatus(world, read)
      return read
    })(readableNote(world.records(), viewerId, params.id)),
  'drafts.list': (_, viewerId) =>
    T.sync(() => ({
      drafts: world.records().notes.filter((note) => note.status === 'draft' && note.authorId === viewerId),
    })),
  'drafts.create': ({ body }, viewerId) =>
    T.map((room: ConversationRecord) =>
      saveDraft(world, {
        conversationId: room.id,
        authorId: viewerId,
        body: body.body,
        inReplyTo: body.inReplyTo ?? null,
        agentName: null,
        basis: null,
        tags: tagsIn(world.records(), room, viewerId, body.tags ?? [], body.inReplyTo ?? null),
      }),
    )(destinationOf(world, viewerId, body)),
  'drafts.update': ({ params, body }, viewerId) =>
    T.gen(function* () {
      const draft = yield* ownDraft(world.records(), viewerId, params.id)
      if (body.channel !== undefined) return yield* T.fail(Forbidden({ message: MOVING_REFUSED }))
      const room = yield* roomOf(world.records(), viewerId, draft.conversationId)
      const tags =
        body.tags === undefined
          ? draft.tags
          : tagsIn(world.records(), room, viewerId, body.tags, draft.inReplyTo)
      const changed = changeNote(world, draft.id, ({ tags: _, ...current }) => ({
        ...current,
        ...(tags !== undefined && tags.length > 0 && { tags: [...tags] }),
        body: body.body ?? current.body,
        origin:
          body.body !== undefined && body.body !== current.body && current.origin === 'agent'
            ? 'human_edited'
            : current.origin,
        updatedAt: world.clock.now(),
      }))
      world.emit([viewerId], { type: 'draft.saved', note: changed })
      return changed
    }),
  'drafts.send': ({ params, body }, viewerId) =>
    T.gen(function* () {
      const draft = yield* draftToDecide(world.records(), viewerId, params.id)
      if (
        draft.body !== body.expected.body ||
        draft.conversationId !== body.expected.conversationId ||
        !isSameTags(draft.tags, body.expected.tags)
      )
        return yield* T.fail(Conflict({ message: DRAFT_CHANGED }))
      const isReview = draft.authorId !== viewerId
      const sent = sendDraft(world, draft, {
        body: body.body ?? draft.body,
        approvedBy: isReview ? viewerId : null,
      })
      if (!isReview) {
        offerAfterDecision(world, draft, sent.body)
        answerLater(world, sent)
      } else keepDecision(world, draft, viewerId, null)
      return sent
    }),
  'drafts.discard': ({ params, body }, viewerId) =>
    T.gen(function* () {
      const draft = yield* draftToDecide(world.records(), viewerId, params.id)
      const reviewers = reviewersOf(world.records(), draft)
      const discarded = changeNote(world, draft.id, (current) => ({
        ...current,
        status: 'discarded',
        updatedAt: world.clock.now(),
      }))
      if (draft.authorId === viewerId) {
        offerAfterDecision(world, draft, null)
        world.emit([viewerId], {
          type: 'draft.discarded',
          noteId: discarded.id,
          conversationId: discarded.conversationId,
        })
      } else {
        keepDecision(world, draft, viewerId, body.reason?.trim() || null)
        world.emit(reviewers, { type: 'review.changed', noteId: discarded.id })
      }
      return discarded
    }),
  'draftRequests.list': (_, viewerId) =>
    T.sync(() => ({ requests: openDraftRequests(world.records(), viewerId, world.clock.now()) })),
  'draftRequests.create': ({ body }, viewerId) => requestDraft(world, viewerId, body),
  'draftRequests.cancel': ({ params }, viewerId) => cancelDraftRequest(world, viewerId, params.id),
  'drafts.seen': ({ params }, viewerId) =>
    T.map(() => ({}))(draftToDecide(world.records(), viewerId, params.id)),
  'search.notes': ({ query }, viewerId) =>
    T.sync(() => {
      const needle = query.q.toLowerCase()
      const records = world.records()
      return {
        notes: records.notes
          .filter(
            (note) =>
              note.body.toLowerCase().includes(needle) &&
              (note.status === 'sent' || note.authorId === viewerId) &&
              mayRead(records, viewerId, note) &&
              isParticipant(records, viewerId, note.conversationId),
          )
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, Number(query.limit ?? SEARCH_LIMIT)),
      }
    }),
  'answers.earlier': ({ body }, viewerId) =>
    T.sync(() => {
      const records = world.records()
      const isSentHere = (note: Note | undefined): note is Note =>
        note !== undefined && note.status === 'sent' && isParticipant(records, viewerId, note.conversationId)
      const candidates = records.notes.flatMap((answer) => {
        const question = records.notes.find((note) => note.id === answer.inReplyTo)
        if (!isSentHere(answer) || !isSentHere(question) || question.authorId === answer.authorId) return []
        const channel = records.channels.find((each) => each.conversationId === answer.conversationId)
        return [{ question, answer, channel: channel?.slug ?? null }]
      })
      const destination =
        body.conversationId ??
        records.channels.find((each) => each.slug === body.channel)?.conversationId ??
        null
      return { answers: rankEarlierAnswers(candidates, questionTerms(body.question), destination) }
    }),
  'answers.used': ({ params, body }, viewerId) =>
    T.flatMap(() => T.map(() => ({}))(roomOf(world.records(), viewerId, body.conversationId)))(
      readableNote(world.records(), viewerId, params.id),
    ),
})

const SEARCH_LIMIT = 20

const MOVING_REFUSED = 'In the demo a draft stays in its conversation.'

const readableNote = (records: Records, viewerId: MemberId, id: string): T.Task<Note, ApiError> =>
  found(
    records.notes.find((note) => note.id === id && mayRead(records, viewerId, note)),
    'No such note.',
  )

const ownDraft = (records: Records, viewerId: MemberId, id: string): T.Task<Note, ApiError> =>
  found(
    records.notes.find((note) => note.id === id && note.authorId === viewerId && note.status === 'draft'),
    'No such draft.',
  )

/** The viewer's own draft, or a channel's agent's draft they review; nobody else's is found (rule 1). */
const draftToDecide = (records: Records, viewerId: MemberId, id: string): T.Task<Note, ApiError> =>
  found(
    records.notes.find(
      (note) =>
        note.id === id &&
        note.status === 'draft' &&
        (note.authorId === viewerId || reviewOf(records, viewerId, note) !== null),
    ),
    'No such draft.',
  )

const muting = (world: World, viewerId: MemberId, id: string, muted: boolean) =>
  T.map((room: ConversationRecord) => {
    const changed = {
      ...room,
      mutedBy: muted
        ? [...room.mutedBy.filter((each) => each !== viewerId), viewerId]
        : room.mutedBy.filter((each) => each !== viewerId),
    }
    world.update((records) => ({
      ...records,
      conversations: records.conversations.map((each) => (each.id === room.id ? changed : each)),
    }))
    return conversationAsSeen(world.records(), viewerId, changed)
  })(roomOf(world.records(), viewerId, id))

const hiding = (world: World, viewerId: MemberId, id: string, hidden: boolean) =>
  T.map((room: ConversationRecord) => {
    const others = (room.hiddenBy ?? []).filter((each) => each.memberId !== viewerId)
    const changed = {
      ...room,
      hiddenBy: hidden ? [...others, { memberId: viewerId, at: world.clock.now() }] : others,
    }
    world.update((records) => ({
      ...records,
      conversations: records.conversations.map((each) => (each.id === room.id ? changed : each)),
    }))
    return conversationAsSeen(world.records(), viewerId, changed)
  })(roomOf(world.records(), viewerId, id))

const ONLY_GROUPS_LEFT = 'Only a group message can be left.'

const RECALL_REFUSED = 'Only a note your saved answer sent can be recalled, in the first five minutes.'

/** Keeps who decided a channel's agent's answer, with the agent's own words and the reason, for its managers. */
const keepDecision = (world: World, draft: Note, decidedBy: MemberId, reason: string | null): void =>
  world.update((records) => ({
    ...records,
    decisions: [
      ...records.decisions,
      { noteId: draft.id, decidedBy, decidedAt: world.clock.now(), agentAnswer: draft.body, reason },
    ],
  }))

/** Whom a draft asks, as Dovecote stores it: only in a group message, and only people in it. */
const tagsIn = (
  records: Records,
  room: ConversationRecord,
  authorId: MemberId,
  tags: ReadonlyArray<MemberId>,
  inReplyTo: NoteId | null,
): ReadonlyArray<MemberId> => {
  if (room.kind !== 'group' || room.privateQuestionOf !== undefined) return []
  const answered = records.notes.find((note) => note.id === inReplyTo)?.authorId ?? null
  return tagsAsked({
    authorId,
    tags: tags.filter((id) => room.participantIds.includes(id)),
    answeredAuthorId: answered !== null && room.participantIds.includes(answered) ? answered : null,
  })
}
