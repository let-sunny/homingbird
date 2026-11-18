import type {
  Conversation,
  ConversationId,
  DirectoryEntry,
  DraftRequest,
  Member,
  MemberId,
  Note,
  NoteId,
  Receipt,
  StatusSummary,
} from '@homingbird/protocol'
import { requestAnsweredBy } from './draft-requests.ts'

export type ThreadItem =
  | { readonly type: 'note'; readonly key: string; readonly note: Note }
  | {
      readonly type: 'drafts'
      readonly key: string
      readonly inReplyTo: NoteId | null
      readonly drafts: ReadonlyArray<Note>
    }

export const threadItems = (
  notes: ReadonlyArray<Note>,
  requests: ReadonlyArray<DraftRequest> = [],
): ThreadItem[] => {
  const sent = notes.filter((note) => note.status === 'sent').sort(bySentTime)
  const drafts = notes.filter((note) => note.status === 'draft').sort(byCreatedTime)
  const groups = Map.groupBy(
    drafts,
    (draft) => requestAnsweredBy(requests, draft.id)?.id ?? draft.inReplyTo ?? draft.id,
  )
  return [
    ...sent.map((note): ThreadItem => ({ type: 'note', key: note.id, note })),
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

export const upsertNote = (notes: ReadonlyArray<Note>, note: Note): Note[] =>
  notes.some((existing) => existing.id === note.id)
    ? notes.map((existing) => (existing.id === note.id ? note : existing))
    : [...notes, note]

export const withoutNote = (notes: ReadonlyArray<Note>, id: NoteId): Note[] =>
  notes.filter((note) => note.id !== id)

export const withNoteFiled = <Thread extends { readonly notes: ReadonlyArray<Note> }>(
  threads: ReadonlyMap<ConversationId, Thread>,
  note: Note,
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
  notes: ReadonlyArray<Note>,
  id: NoteId,
  receipts: ReadonlyArray<Receipt>,
): Note[] => notes.map((note) => (note.id === id ? { ...note, receipts } : note))

export const withoutMovedQuestion = <Thread extends { readonly notes: ReadonlyArray<Note> }>(
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
  entries: ReadonlyArray<DirectoryEntry>,
  changes: ReadonlyArray<PresenceChange>,
): DirectoryEntry[] => {
  const changed = new Map(changes.map((change) => [change.memberId, change]))
  return entries.map((entry) => {
    const presence = changed.get(entry.member.id)
    return presence === undefined
      ? entry
      : { ...entry, presence: { humanOnline: presence.humanOnline, agentOnline: presence.agentOnline } }
  })
}

export const noteAwaitingReply = (notes: ReadonlyArray<Note>, viewerId: MemberId): Note | null =>
  notes
    .filter((note) => note.status === 'sent' && note.authorId !== viewerId)
    .filter((note) =>
      note.receipts.some((receipt) => receipt.memberId === viewerId && receipt.repliedAt === null),
    )
    .sort(bySentTime)
    .at(-1) ?? null

export const isUnreadBy = (note: Note, viewerId: MemberId): boolean =>
  note.status === 'sent' &&
  note.authorId !== viewerId &&
  note.receipts.some((receipt) => receipt.memberId === viewerId && receipt.readAt === null)

export const otherParticipants = (conversation: Conversation, viewerId: MemberId): MemberId[] =>
  conversation.participantIds.filter((memberId) => memberId !== viewerId)

export const conversationTitle = (
  conversation: Conversation,
  members: ReadonlyMap<MemberId, Member>,
  viewerId: MemberId,
  unknownName: string,
): string =>
  (conversation.kind === 'topic' && conversation.title !== null ? `#${conversation.title}` : null) ??
  conversation.title ??
  otherParticipants(conversation, viewerId)
    .map((memberId) => members.get(memberId)?.name ?? unknownName)
    .join(', ')

export const showsAuthors = (conversation: Conversation | undefined): boolean =>
  conversation !== undefined && conversation.kind !== 'dm'

export const answeredBy = (note: Note): MemberId[] =>
  note.receipts.filter((receipt) => receipt.state === 'replied').map((receipt) => receipt.memberId)

export const isOpenQuestion = (note: Note, notes: ReadonlyArray<Note>): boolean =>
  note.status === 'sent' &&
  note.inReplyTo === null &&
  answeredBy(note).length === 0 &&
  !notes.some((other) => other.status === 'sent' && other.inReplyTo === note.id)

export interface ReadProgress {
  readonly read: number
  readonly of: number
  readonly drafting: number
}

export const readProgress = (receipts: ReadonlyArray<Receipt>): ReadProgress => ({
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
): Note[] => (item.inReplyTo === null ? item.drafts.filter((draft) => draft.id !== sentId) : [])

export const excerpt = (text: string, length = 80): string => {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length <= length ? singleLine : `${singleLine.slice(0, length - 1)}…`
}

const bySentTime = (a: Note, b: Note): number => (a.sentAt ?? 0) - (b.sentAt ?? 0) || a.id.localeCompare(b.id)

const byCreatedTime = (a: Note, b: Note): number => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
