import type * as AsRead from '../as-read.ts'
import { UNKNOWN } from '../compatibility.ts'
import type { MemberId } from '../ids.ts'
import type { Member } from '../model.ts'
import { UNKNOWN_STATUS_TEXT, describeStatus, summarize } from '../status.ts'
import { wrapNote } from '../wrap.ts'

/** A colleague's note as a model reads it: inside wrapNote, under its author's name, or its Slack asker's. */
export const quotedNote = (
  note: Pick<AsRead.Note, 'id' | 'authorId' | 'sentAt' | 'body' | 'via' | 'tags'>,
  quoting: Quoting,
): string => {
  const author =
    note.via === undefined
      ? authorOf(quoting.authors, note.authorId)
      : { name: note.via.askerName, email: `in Slack #${note.via.channelName}` }
  return wrapNote({
    noteId: note.id,
    authorName: author.name,
    authorEmail: author.email,
    sentAt: note.sentAt,
    body: note.body,
    nonce: quoting.nonce(),
    ...(note.tags !== undefined && { asks: note.tags.map((id) => authorOf(quoting.authors, id).name) }),
  })
}

/** The quoted note followed by where it stands, for a tool that lists notes. */
export const quotedNoteWithState = (note: AsRead.Note, quoting: Quoting): string =>
  [
    quotedNote(note, quoting),
    `[note ${note.id} in conversation ${note.conversationId}: ${stateOf(note)}]`,
  ].join('\n')

export const quotedNotesWithState = (notes: ReadonlyArray<AsRead.Note>, quoting: Quoting): string =>
  notes.map((note) => quotedNoteWithState(note, quoting)).join('\n\n')

/** A thread as its reader's agent sees it: the reader's own notes as written, every other note quoted. */
export const quotedThread = (
  notes: ReadonlyArray<AsRead.Note>,
  viewerId: MemberId,
  quoting: Quoting,
): string =>
  notes
    .map((note) => (note.authorId === viewerId ? ownNoteText(note) : quotedNote(note, quoting)))
    .join('\n\n')

/** A note of the reader's own: their words, not a colleague's, so it is shown as it is. */
export const ownNoteText = (note: AsRead.Note): string =>
  `[${note.id}] you, ${note.status === UNKNOWN ? UNKNOWN_STATUS_TEXT : note.status}${note.inReplyTo === null ? '' : `, replying to ${note.inReplyTo}`}:\n${note.body}`

export interface Quoting {
  readonly authors: Authors
  readonly nonce: () => string
}

export type Authors = ReadonlyMap<MemberId, Pick<Member, 'name' | 'email'>>

export const authorsIn = (
  entries: ReadonlyArray<{ readonly member: Pick<AsRead.Member, 'id' | 'name' | 'email'> }>,
): Authors => new Map(entries.map((entry) => [entry.member.id, entry.member]))

export const authorOf = (authors: Authors, id: MemberId): Pick<Member, 'name' | 'email'> =>
  authors.get(id) ?? UNKNOWN_AUTHOR

export const UNKNOWN_AUTHOR = { name: 'Unknown member', email: 'unknown' } as const

const stateOf = (note: AsRead.Note): string => {
  if (note.status === 'draft') return 'draft waiting for approval, not sent'
  if (note.status === 'discarded') return 'discarded, never sent'
  if (note.status === 'withdrawn') return 'recalled by its author'
  if (note.status !== 'sent') return UNKNOWN_STATUS_TEXT
  const reply = note.inReplyTo === null ? '' : `, in reply to ${note.inReplyTo}`
  return `sent${reply}, ${describeStatus(summarize(note.receipts)).toLowerCase()}`
}
