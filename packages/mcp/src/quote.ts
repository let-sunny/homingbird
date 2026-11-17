import {
  type Member,
  type MemberId,
  type Note,
  describeStatus,
  summarize,
  wrapNote,
} from '@homingbird/protocol'

export interface Quoting {
  readonly nonce: () => string
  readonly authors: ReadonlyMap<MemberId, Pick<Member, 'name' | 'email'>>
}

export const quoteNote = (note: Note, quoting: Quoting): string => {
  const author = quoting.authors.get(note.authorId)
  return [
    wrapNote({
      noteId: note.id,
      authorName: author?.name ?? 'Unknown member',
      authorEmail: author?.email ?? 'unknown',
      sentAt: note.sentAt,
      body: note.body,
      nonce: quoting.nonce(),
    }),
    `[note ${note.id} in conversation ${note.conversationId}: ${stateOf(note)}]`,
  ].join('\n')
}

export const quoteNotes = (notes: ReadonlyArray<Note>, quoting: Quoting): string =>
  notes.map((note) => quoteNote(note, quoting)).join('\n\n')

const stateOf = (note: Note): string => {
  if (note.status === 'draft') return 'draft waiting for approval, not sent'
  if (note.status === 'discarded') return 'discarded, never sent'
  const reply = note.inReplyTo === null ? '' : `, in reply to ${note.inReplyTo}`
  return `sent${reply}, ${describeStatus(summarize(note.receipts)).toLowerCase()}`
}
