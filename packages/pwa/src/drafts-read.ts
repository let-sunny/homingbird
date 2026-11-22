import {
  type AsRead,
  type ConversationId,
  type DraftAsShown,
  type NoteId,
  isSameTags,
} from '@homingbird/protocol'
import type { Thread } from './state.ts'

/**
 * Remembers each draft as it first reached the page, so that a later change the person did not make
 * shows on its card instead of slipping under a Send they were about to press.
 */
export const withDraftsAsRead = (
  read: ReadonlyMap<NoteId, DraftAsShown>,
  threads: ReadonlyMap<ConversationId, Thread>,
): ReadonlyMap<NoteId, DraftAsShown> => {
  const unknown = [...threads.values()]
    .flatMap((thread) => thread.notes)
    .filter((note) => note.status === 'draft' && !read.has(note.id))
  return unknown.length === 0
    ? read
    : new Map([...read, ...unknown.map((note) => [note.id, asRead(note)] as const)])
}

/** The same for the answers a manager reviews: each is remembered as it first reached the page. */
export const withReviewsAsRead = (
  read: ReadonlyMap<NoteId, DraftAsShown>,
  reviews: ReadonlyArray<AsRead.Review>,
): ReadonlyMap<NoteId, DraftAsShown> => {
  const unknown = reviews.map((review) => review.note).filter((note) => !read.has(note.id))
  return unknown.length === 0
    ? read
    : new Map([...read, ...unknown.map((note) => [note.id, asRead(note)] as const)])
}

/** Whether the text, the room or whom a draft tags is not what the person last read. */
export const isChangedSinceRead = (read: ReadonlyMap<NoteId, DraftAsShown>, draft: AsRead.Note): boolean => {
  const known = read.get(draft.id)
  return (
    known !== undefined &&
    (known.body !== draft.body ||
      known.conversationId !== draft.conversationId ||
      !isSameTags(known.tags, draft.tags))
  )
}

/** The draft as the person reads it now. */
export const withDraftRead = (
  read: ReadonlyMap<NoteId, DraftAsShown>,
  draft: AsRead.Note,
): ReadonlyMap<NoteId, DraftAsShown> => new Map(read).set(draft.id, asRead(draft))

/**
 * What a send binds to: the text and room the person read and, for a reply to a question from Slack, how
 * far its thread had got in the question they read, so that newer messages there stop the send once.
 */
export const asShown = (read: DraftAsShown, answered: AsRead.Note | null): DraftAsShown =>
  answered?.via === undefined ? read : { ...read, threadAt: answered.via.threadAt }

export const asRead = (draft: AsRead.Note): DraftAsShown => ({
  body: draft.body,
  conversationId: draft.conversationId,
  ...(draft.tags !== undefined && { tags: draft.tags }),
})
