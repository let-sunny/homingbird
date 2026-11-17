import type { Conversation, Member, MemberId, Note, NoteId, Receipt } from '@homingbird/protocol'

export type ThreadItem =
  | { readonly type: 'note'; readonly key: string; readonly note: Note }
  | {
      readonly type: 'drafts'
      readonly key: string
      readonly inReplyTo: NoteId | null
      readonly drafts: ReadonlyArray<Note>
    }

export const threadItems = (notes: ReadonlyArray<Note>): ThreadItem[] => {
  const sent = notes.filter((note) => note.status === 'sent').sort(bySentTime)
  const drafts = notes.filter((note) => note.status === 'draft').sort(byCreatedTime)
  const groups = Map.groupBy(drafts, (draft) => draft.inReplyTo ?? draft.id)
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

export const withoutNote = (notes: ReadonlyArray<Note>, id: NoteId): Note[] => notes.filter((note) => note.id !== id)

export const withReceipts = (notes: ReadonlyArray<Note>, id: NoteId, receipts: ReadonlyArray<Receipt>): Note[] =>
  notes.map((note) => (note.id === id ? { ...note, receipts } : note))

export const noteAwaitingReply = (notes: ReadonlyArray<Note>, viewerId: MemberId): Note | null =>
  notes
    .filter((note) => note.status === 'sent' && note.authorId !== viewerId)
    .filter((note) => note.receipts.some((receipt) => receipt.memberId === viewerId && receipt.repliedAt === null))
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
  conversation.title ??
  otherParticipants(conversation, viewerId)
    .map((memberId) => members.get(memberId)?.name ?? unknownName)
    .join(', ')

export const excerpt = (text: string, length = 80): string => {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length <= length ? singleLine : `${singleLine.slice(0, length - 1)}…`
}

const bySentTime = (a: Note, b: Note): number => (a.sentAt ?? 0) - (b.sentAt ?? 0) || a.id.localeCompare(b.id)

const byCreatedTime = (a: Note, b: Note): number => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
