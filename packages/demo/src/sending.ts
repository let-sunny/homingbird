import type { ConversationId, MemberId, Note, NoteId, Receipt } from '@homingbird/protocol'
import { managersOf, memberById } from './reads.ts'
import type { Records, World } from './world.ts'

/**
 * Sends a draft as its author approved it, or as `approvedBy` approved a channel's agent's answer:
 * delivers it, marks the question it answers replied, and tells everyone who takes part.
 */
export const sendDraft = (
  world: World,
  draft: Note,
  decision: { readonly body: string; readonly approvedBy: MemberId | null },
): Note => {
  const records = world.records()
  const now = world.clock.now()
  const sent = changeNote(world, draft.id, (current) => ({
    ...current,
    status: 'sent',
    body: decision.body,
    origin: decision.body !== current.body && current.origin === 'agent' ? 'human_edited' : current.origin,
    sentAt: now,
    updatedAt: now,
    approvedBy: decision.approvedBy,
    receipts: recipientsOf(records, draft).map((memberId) => delivered(memberId, now)),
  }))
  touch(world, sent.conversationId, now)
  const question = settleQuestion(world, sent, now)
  world.emit(participantsOf(world.records(), sent.conversationId), { type: 'note.sent', note: sent })
  if (question !== null) announceStatus(world, question)
  if (decision.approvedBy !== null)
    world.emit(reviewersOf(world.records(), sent), { type: 'review.changed', noteId: sent.id })
  return sent
}

/**
 * Keeps a new draft. A person's draft is announced to them alone; a channel's agent's answer only to
 * the managers who may send it, never to the person it answers (rule 2).
 */
export const saveDraft = (world: World, fields: DraftFields): Note => {
  const now = world.clock.now()
  const draft: Note = {
    id: world.nextId('note') as NoteId,
    conversationId: fields.conversationId,
    authorId: fields.authorId,
    status: 'draft',
    body: fields.body,
    inReplyTo: fields.inReplyTo,
    origin: fields.agentName === null && fields.fromDebate === undefined ? 'human' : 'agent',
    agentName: fields.agentName,
    createdAt: now,
    updatedAt: now,
    sentAt: null,
    receipts: [],
    basis: fields.basis,
    approvedBy: null,
    ...(fields.fromDebate !== undefined && { fromDebate: fields.fromDebate }),
  }
  world.update((records) => ({ ...records, notes: [...records.notes, draft] }))
  if (memberById(world.records(), draft.authorId)?.kind === 'channel_agent')
    world.emit(reviewersOf(world.records(), draft), { type: 'review.changed', noteId: draft.id })
  else world.emit([draft.authorId], { type: 'draft.saved', note: draft })
  return draft
}

export interface DraftFields {
  readonly conversationId: ConversationId
  readonly authorId: MemberId
  readonly body: string
  readonly inReplyTo: NoteId | null
  /** The agent that wrote it; null for a person's own words. */
  readonly agentName: string | null
  readonly basis: string | null
  /** The debate room whose result this is: written by its agents, as Dovecote records it. */
  readonly fromDebate?: Note['fromDebate']
}

/** The managers who may send a channel's agent's answer: all of its channel's, except the person who asked. */
export const reviewersOf = (records: Records, note: Note): MemberId[] => {
  const channel = records.channels.find((each) => each.agentId === note.authorId)
  const question = records.notes.find((each) => each.id === note.inReplyTo)
  return channel === undefined ? [] : managersOf(records, channel).filter((id) => id !== question?.authorId)
}

export const changeNote = (world: World, id: NoteId, change: (note: Note) => Note): Note => {
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

export const announceStatus = (world: World, note: Note): void =>
  world.emit(participantsOf(world.records(), note.conversationId), {
    type: 'note.status',
    noteId: note.id,
    conversationId: note.conversationId,
    receipts: note.receipts,
  })

export const participantsOf = (records: Records, conversationId: string): ReadonlyArray<MemberId> =>
  records.conversations.find((room) => room.id === conversationId)?.participantIds ?? []

/**
 * Who a sent note reaches: everyone else in a direct or group conversation; in a channel's room, the
 * person whose question it answers, or for a new question the people whose agents answer there and the
 * channel's own agent.
 */
const recipientsOf = (records: Records, draft: Note): MemberId[] => {
  const room = records.conversations.find((each) => each.id === draft.conversationId)
  const others = (room?.participantIds ?? []).filter((id) => id !== draft.authorId)
  if (room?.kind !== 'channel') return others
  const answered = records.notes.find((note) => note.id === draft.inReplyTo)
  if (answered !== undefined && answered.authorId !== draft.authorId)
    return others.filter((id) => id === answered.authorId)
  const channel = records.channels.find((each) => each.conversationId === room.id)
  const helpers = [
    ...(channel?.answering ?? []),
    ...(channel === undefined || channel.agentId === null ? [] : [channel.agentId]),
  ]
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

const touch = (world: World, conversationId: ConversationId, now: number): void =>
  world.update((records) => ({
    ...records,
    conversations: records.conversations.map((room) =>
      room.id === conversationId ? { ...room, lastActivityAt: now } : room,
    ),
  }))

/**
 * The question a sent reply answers, marked replied by the reply's author only, never by the manager who
 * approved it, and the author's other drafts for it discarded.
 */
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
      receipt.memberId === reply.authorId
        ? { ...receipt, state: 'replied', readAt: receipt.readAt ?? now, repliedAt: now }
        : receipt,
    ),
  }))
}
