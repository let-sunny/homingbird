import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  Conflict,
  type ConversationId,
  DRAFT_CHANGED,
  Forbidden,
  Invalid,
  type MemberId,
  type Note,
  type NoteId,
  type Receipt,
} from '@homingbird/protocol'
import { type Handlers, found } from './handlers.ts'
import {
  conversationAsSeen,
  conversationsOf,
  isParticipant,
  managersOf,
  mayRead,
  notesSeenIn,
  reviewOf,
} from './reads.ts'
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
      const participantIds = [viewerId, ...body.participantIds.filter((id) => id !== viewerId)]
      const existing = world
        .records()
        .conversations.find(
          (room) =>
            room.kind !== 'channel' &&
            room.participantIds.length === participantIds.length &&
            participantIds.every((id) => room.participantIds.includes(id)),
        )
      const room = existing ?? newRoom(world, participantIds, body.title ?? null)
      if (existing === undefined)
        world.update((records) => ({ ...records, conversations: [...records.conversations, room] }))
      return conversationAsSeen(world.records(), viewerId, room)
    }),
  'conversations.mute': ({ params }, viewerId) => muting(world, viewerId, params.id, true),
  'conversations.unmute': ({ params }, viewerId) => muting(world, viewerId, params.id, false),
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
    T.gen(function* () {
      const room = yield* destinationOf(world, viewerId, body)
      const now = world.clock.now()
      const draft: Note = {
        id: world.nextId('note') as NoteId,
        conversationId: room.id,
        authorId: viewerId,
        status: 'draft',
        body: body.body,
        inReplyTo: body.inReplyTo ?? null,
        origin: 'human',
        agentName: null,
        createdAt: now,
        updatedAt: now,
        sentAt: null,
        receipts: [],
        basis: null,
        approvedBy: null,
      }
      world.update((records) => ({ ...records, notes: [...records.notes, draft] }))
      world.emit([viewerId], { type: 'draft.saved', note: draft })
      return draft
    }),
  'drafts.update': ({ params, body }, viewerId) =>
    T.gen(function* () {
      const draft = yield* ownDraft(world.records(), viewerId, params.id)
      if (body.channel !== undefined) return yield* T.fail(Forbidden({ message: MOVING_REFUSED }))
      const changed = changeNote(world, draft.id, (current) => ({
        ...current,
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
      const records = world.records()
      const draft = yield* draftToDecide(records, viewerId, params.id)
      if (draft.body !== body.expected.body || draft.conversationId !== body.expected.conversationId)
        return yield* T.fail(Conflict({ message: DRAFT_CHANGED }))
      const isReview = draft.authorId !== viewerId
      const now = world.clock.now()
      const text = body.body ?? draft.body
      const sent = changeNote(world, draft.id, (current) => ({
        ...current,
        status: 'sent',
        body: text,
        origin: text !== current.body && current.origin === 'agent' ? 'human_edited' : current.origin,
        sentAt: now,
        updatedAt: now,
        approvedBy: isReview ? viewerId : null,
        receipts: recipientsOf(records, draft).map((memberId) => delivered(memberId, now)),
      }))
      world.update((current) => ({
        ...current,
        conversations: current.conversations.map((room) =>
          room.id === sent.conversationId ? { ...room, lastActivityAt: now } : room,
        ),
      }))
      const question = settleQuestion(world, sent, now)
      const participants = participantsOf(world.records(), sent.conversationId)
      world.emit(participants, { type: 'note.sent', note: sent })
      if (question !== null) announceStatus(world, question)
      if (isReview)
        world.emit(reviewersOf(world.records(), sent), { type: 'review.changed', noteId: sent.id })
      return sent
    }),
  'drafts.discard': ({ params }, viewerId) =>
    T.gen(function* () {
      const draft = yield* draftToDecide(world.records(), viewerId, params.id)
      const reviewers = reviewersOf(world.records(), draft)
      const discarded = changeNote(world, draft.id, (current) => ({
        ...current,
        status: 'discarded',
        updatedAt: world.clock.now(),
      }))
      if (draft.authorId === viewerId)
        world.emit([viewerId], {
          type: 'draft.discarded',
          noteId: discarded.id,
          conversationId: discarded.conversationId,
        })
      else world.emit(reviewers, { type: 'review.changed', noteId: discarded.id })
      return discarded
    }),
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
})

const SEARCH_LIMIT = 20

const MOVING_REFUSED = 'In the demo a draft stays in its conversation.'

const roomOf = (records: Records, viewerId: MemberId, id: string): T.Task<ConversationRecord, ApiError> =>
  found(
    records.conversations.find((room) => room.id === id && room.participantIds.includes(viewerId)),
    'No such conversation.',
  )

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

const destinationOf = (
  world: World,
  viewerId: MemberId,
  body: {
    readonly conversationId?: ConversationId
    readonly to?: ReadonlyArray<MemberId>
    readonly channel?: string
  },
): T.Task<ConversationRecord, ApiError> => {
  const records = world.records()
  if (body.conversationId !== undefined) return roomOf(records, viewerId, body.conversationId)
  if (body.channel !== undefined) {
    const channel = records.channels.find((each) => each.slug === body.channel)
    return channel === undefined
      ? T.fail(Invalid({ message: 'No such channel.' }))
      : roomOf(records, viewerId, channel.conversationId)
  }
  return T.fail(Invalid({ message: 'Say which conversation the draft is for.' }))
}

const newRoom = (
  world: World,
  participantIds: ReadonlyArray<MemberId>,
  title: string | null,
): ConversationRecord => {
  const now = world.clock.now()
  return {
    id: world.nextId('conv') as ConversationId,
    kind: participantIds.length === 2 ? 'direct' : 'group',
    title,
    participantIds,
    createdAt: now,
    lastActivityAt: now,
    mutedBy: [],
    ...(participantIds.length > 2 && { startedBy: participantIds[0]! }),
  }
}

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

const changeNote = (world: World, id: NoteId, change: (note: Note) => Note): Note => {
  let changed: Note | undefined
  world.update((records) => ({
    ...records,
    notes: records.notes.map((note) => {
      if (note.id !== id) return note
      changed = change(note)
      return changed
    }),
  }))
  return changed!
}

/**
 * Who a sent note reaches: everyone else in a direct or group conversation; in a channel's room, the
 * person whose question it answers, or for a new question the people whose agents answer there.
 */
const recipientsOf = (records: Records, draft: Note): MemberId[] => {
  const room = records.conversations.find((each) => each.id === draft.conversationId)
  const others = (room?.participantIds ?? []).filter((id) => id !== draft.authorId)
  if (room?.kind !== 'channel') return others
  const answered = records.notes.find((note) => note.id === draft.inReplyTo)
  if (answered !== undefined && answered.authorId !== draft.authorId)
    return others.filter((id) => id === answered.authorId)
  const helpers = records.channels.find((channel) => channel.conversationId === room.id)?.answering ?? []
  return others.filter((id) => helpers.includes(id))
}

const delivered = (memberId: MemberId, at: number): Receipt => ({
  memberId,
  state: 'delivered',
  deliveredAt: at,
  readAt: null,
  draftingAt: null,
  repliedAt: null,
})

/** The question a sent reply answers, marked replied by the reply's author, and their other drafts for it discarded. */
const settleQuestion = (world: World, reply: Note, now: number): Note | null => {
  if (reply.inReplyTo === null) return null
  const question = world.records().notes.find((note) => note.id === reply.inReplyTo)
  if (question === undefined) return null
  world.update((records) => ({
    ...records,
    notes: records.notes.map((note) =>
      note.status === 'draft' && note.inReplyTo === question.id && note.authorId === reply.authorId
        ? { ...note, status: 'discarded', updatedAt: now }
        : note,
    ),
  }))
  return changeNote(world, question.id, (current) => ({
    ...current,
    receipts: current.receipts.map((receipt) =>
      receipt.memberId === reply.authorId || receipt.memberId === reply.approvedBy
        ? { ...receipt, state: 'replied', readAt: receipt.readAt ?? now, repliedAt: now }
        : receipt,
    ),
  }))
}

const announceStatus = (world: World, note: Note): void =>
  world.emit(participantsOf(world.records(), note.conversationId), {
    type: 'note.status',
    noteId: note.id,
    conversationId: note.conversationId,
    receipts: note.receipts,
  })

const participantsOf = (records: Records, conversationId: string): ReadonlyArray<MemberId> =>
  records.conversations.find((room) => room.id === conversationId)?.participantIds ?? []

const reviewersOf = (records: Records, note: Note): MemberId[] => {
  const channel = records.channels.find((each) => each.agentId === note.authorId)
  const question = records.notes.find((each) => each.id === note.inReplyTo)
  return channel === undefined ? [] : managersOf(records, channel).filter((id) => id !== question?.authorId)
}
