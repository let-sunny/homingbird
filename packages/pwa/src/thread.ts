import type {
  AsRead,
  ConversationId,
  DraftRequest,
  MemberId,
  NoteId,
  StatusSummary,
} from '@homingbird/protocol'
import { requestAnsweredBy } from './draft-requests.ts'

export type ThreadItem =
  | {
      readonly type: 'note'
      readonly key: string
      readonly note: AsRead.Note
      readonly leadsRun: boolean
      readonly next: AsRead.Note | null
    }
  | {
      readonly type: 'drafts'
      readonly key: string
      readonly inReplyTo: NoteId | null
      readonly drafts: ReadonlyArray<AsRead.Note>
    }

export const threadItems = (
  notes: ReadonlyArray<AsRead.Note>,
  requests: ReadonlyArray<DraftRequest> = [],
): ThreadItem[] => {
  const sent = notes.filter((note) => note.status === 'sent').sort(bySentTime)
  const drafts = notes.filter((note) => note.status === 'draft').sort(byCreatedTime)
  const groups = Map.groupBy(
    drafts,
    (draft) => requestAnsweredBy(requests, draft.id)?.id ?? draft.inReplyTo ?? draft.id,
  )
  return [
    ...sent.map(
      (note, index): ThreadItem => ({
        type: 'note',
        key: note.id,
        note,
        leadsRun: index === 0 || !isSameRun(sent[index - 1]!, note),
        next: index + 1 < sent.length && isSameRun(note, sent[index + 1]!) ? sent[index + 1]! : null,
      }),
    ),
    ...[...groups].map(
      ([target, group]): ThreadItem => ({
        type: 'drafts',
        key: `drafts:${target}`,
        inReplyTo: group[0]!.inReplyTo,
        drafts: group,
      }),
    ),
  ]
}

export const upsertNote = (notes: ReadonlyArray<AsRead.Note>, note: AsRead.Note): AsRead.Note[] =>
  notes.some((existing) => existing.id === note.id)
    ? notes.map((existing) => (existing.id === note.id ? note : existing))
    : [...notes, note]

export const withoutNote = (notes: ReadonlyArray<AsRead.Note>, id: NoteId): AsRead.Note[] =>
  notes.filter((note) => note.id !== id)

export const withNoteFiled = <Thread extends { readonly notes: ReadonlyArray<AsRead.Note> }>(
  threads: ReadonlyMap<ConversationId, Thread>,
  note: AsRead.Note,
): ReadonlyMap<ConversationId, Thread> =>
  new Map(
    [...threads].map(([conversationId, thread]): [ConversationId, Thread] => {
      const belongsHere = conversationId === note.conversationId && note.status !== 'discarded'
      if (belongsHere) return [conversationId, { ...thread, notes: upsertNote(thread.notes, note) }]
      if (!thread.notes.some((existing) => existing.id === note.id)) return [conversationId, thread]
      return [conversationId, { ...thread, notes: withoutNote(thread.notes, note.id) }]
    }),
  )

export const withReceipts = (
  notes: ReadonlyArray<AsRead.Note>,
  id: NoteId,
  receipts: ReadonlyArray<AsRead.Receipt>,
): AsRead.Note[] => notes.map((note) => (note.id === id ? { ...note, receipts } : note))

export const withoutMovedQuestion = <Thread extends { readonly notes: ReadonlyArray<AsRead.Note> }>(
  threads: ReadonlyMap<ConversationId, Thread>,
  from: ConversationId,
  questionId: NoteId,
): ReadonlyMap<ConversationId, Thread> => {
  const thread = threads.get(from)
  if (thread === undefined) return threads
  const notes = thread.notes.filter((note) => note.id !== questionId && note.inReplyTo !== questionId)
  return new Map(threads).set(from, { ...thread, notes })
}

export interface PresenceChange {
  readonly memberId: MemberId
  readonly humanOnline: boolean
  readonly agentOnline: boolean
}

export const withPresence = (
  entries: ReadonlyArray<AsRead.DirectoryEntry>,
  changes: ReadonlyArray<PresenceChange>,
): AsRead.DirectoryEntry[] => {
  const changed = new Map(changes.map((change) => [change.memberId, change]))
  return entries.map((entry) => {
    const presence = changed.get(entry.member.id)
    return presence === undefined
      ? entry
      : { ...entry, presence: { humanOnline: presence.humanOnline, agentOnline: presence.agentOnline } }
  })
}

export const noteAwaitingReply = (
  notes: ReadonlyArray<AsRead.Note>,
  viewerId: MemberId,
): AsRead.Note | null =>
  notes
    .filter((note) => note.status === 'sent' && note.authorId !== viewerId)
    .filter((note) =>
      note.receipts.some((receipt) => receipt.memberId === viewerId && receipt.repliedAt === null),
    )
    .sort(bySentTime)
    .at(-1) ?? null

export const isUnreadBy = (note: AsRead.Note, viewerId: MemberId): boolean =>
  note.status === 'sent' &&
  note.authorId !== viewerId &&
  note.receipts.some((receipt) => receipt.memberId === viewerId && receipt.readAt === null)

export const otherParticipants = (conversation: AsRead.Conversation, viewerId: MemberId): MemberId[] =>
  conversation.participantIds.filter((memberId) => memberId !== viewerId)

export const conversationTitle = (
  conversation: AsRead.Conversation,
  members: ReadonlyMap<MemberId, AsRead.Member>,
  viewerId: MemberId,
  unknownName: string,
): string => {
  const archived = isArchived(conversation)
  const title = archived ? (conversation.title?.replace(ARCHIVED_SUFFIX, '') ?? null) : conversation.title
  if (title !== null) return conversation.kind === 'channel' || archived ? `#${title}` : title
  return otherParticipants(conversation, viewerId)
    .map((memberId) => members.get(memberId)?.name ?? unknownName)
    .join(', ')
}

export const isArchived = (conversation: AsRead.Conversation | undefined): boolean =>
  conversation !== undefined && conversation.archivedAt !== null

/** The open group conversation of exactly the viewer and these people, if there is one. */
export const groupWith = (
  conversations: ReadonlyArray<AsRead.Conversation>,
  viewerId: MemberId,
  memberIds: ReadonlyArray<MemberId>,
): AsRead.Conversation | undefined => {
  const wanted = new Set([viewerId, ...memberIds])
  return conversations.find(
    (conversation) =>
      conversation.kind === 'group' &&
      !isArchived(conversation) &&
      conversation.participantIds.length === wanted.size &&
      conversation.participantIds.every((memberId) => wanted.has(memberId)),
  )
}

export type Destination =
  | { readonly kind: 'people'; readonly memberIds: ReadonlyArray<MemberId> }
  | { readonly kind: 'channel'; readonly memberIds: ReadonlyArray<MemberId> }

export const draftDestination = (
  conversation: AsRead.Conversation,
  draft: AsRead.Note,
  notes: ReadonlyArray<AsRead.Note>,
  viewerId: MemberId,
): Destination => {
  const question = notes.find((note) => note.id === draft.inReplyTo)
  if (conversation.kind !== 'channel')
    return { kind: 'people', memberIds: otherParticipants(conversation, viewerId) }
  if (question === undefined) return { kind: 'channel', memberIds: [] }
  return { kind: 'people', memberIds: question.authorId === viewerId ? [] : [question.authorId] }
}

export type MyNoteState = 'delivered' | 'read' | 'drafting' | 'returning'

export const myNoteState = (status: SingleStatus): MyNoteState =>
  status === 'replied' ? 'returning' : status === 'sent' ? 'delivered' : status

export const showsAuthors = (conversation: AsRead.Conversation | undefined): boolean =>
  conversation !== undefined && conversation.kind !== 'direct'

export const answeredBy = (note: AsRead.Note): MemberId[] =>
  note.receipts.filter((receipt) => receipt.state === 'replied').map((receipt) => receipt.memberId)

export const isOpenQuestion = (note: AsRead.Note, notes: ReadonlyArray<AsRead.Note>): boolean =>
  note.status === 'sent' &&
  note.inReplyTo === null &&
  answeredBy(note).length === 0 &&
  !notes.some((other) => other.status === 'sent' && other.inReplyTo === note.id)

export interface ReadProgress {
  readonly read: number
  readonly of: number
  readonly drafting: number
}

export const readProgress = (receipts: ReadonlyArray<AsRead.Receipt>): ReadProgress => ({
  read: receipts.filter((receipt) => receipt.readAt !== null).length,
  of: receipts.length,
  drafting: receipts.filter((receipt) => receipt.state === 'drafting').length,
})

export type SingleStatus = 'sent' | 'delivered' | 'read' | 'drafting' | 'replied'

export const statusOf = (summary: StatusSummary): SingleStatus => {
  if (summary.recipients === 0) return 'sent'
  if (summary.replied > 0) return 'replied'
  if (summary.drafting > 0) return 'drafting'
  return summary.read > 0 ? 'read' : 'delivered'
}

export const alternativesLeftAfterSending = (
  item: Extract<ThreadItem, { type: 'drafts' }>,
  sentId: NoteId,
): AsRead.Note[] => (item.inReplyTo === null ? item.drafts.filter((draft) => draft.id !== sentId) : [])

export const excerpt = (text: string, length = 80): string => {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length <= length ? singleLine : `${singleLine.slice(0, length - 1)}…`
}

const ARCHIVED_SUFFIX = / \(archived\)$/

const bySentTime = (a: AsRead.Note, b: AsRead.Note): number =>
  (a.sentAt ?? 0) - (b.sentAt ?? 0) || a.id.localeCompare(b.id)

const byCreatedTime = (a: AsRead.Note, b: AsRead.Note): number =>
  a.createdAt - b.createdAt || a.id.localeCompare(b.id)

/**
 * Consecutive notes by one author, written the same way: by their agent, by their agent and edited by
 * them, or by them. A run shows the character and its mark once, so the mark must hold for every note.
 */
const isSameRun = (a: AsRead.Note, b: AsRead.Note): boolean =>
  a.authorId === b.authorId && a.origin === b.origin
