import { type Member, type MemberId, type Note, wrapNote } from '@homingbird/protocol'

export type Authors = ReadonlyMap<MemberId, Pick<Member, 'name' | 'email'>>

export const UNKNOWN_AUTHOR = { name: 'Unknown member', email: 'unknown' } as const

export const quoteForModel = (note: Note, authors: Authors, nonce: string): string => {
  const author = authors.get(note.authorId) ?? UNKNOWN_AUTHOR
  return wrapNote({
    noteId: note.id,
    authorName: author.name,
    authorEmail: author.email,
    sentAt: note.sentAt,
    body: note.body,
    nonce,
  })
}

export const showOwnNote = (note: Note): string =>
  `[${note.id}] you, ${note.status}${note.inReplyTo === null ? '' : `, replying to ${note.inReplyTo}`}:\n${note.body}`

export const showThread = (
  notes: ReadonlyArray<Note>,
  viewerId: MemberId,
  authors: Authors,
  nonce: () => string,
): string =>
  notes
    .map((note) => (note.authorId === viewerId ? showOwnNote(note) : quoteForModel(note, authors, nonce())))
    .join('\n\n')
