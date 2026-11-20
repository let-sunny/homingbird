import type { AsRead, ConversationId, DraftAsShown, NoteId } from '@homingbird/protocol'
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

/** Whether the text or the room of a draft is not what the person last read. */
export const isChangedSinceRead = (read: ReadonlyMap<NoteId, DraftAsShown>, draft: AsRead.Note): boolean => {
  const known = read.get(draft.id)
  return known !== undefined && (known.body !== draft.body || known.conversationId !== draft.conversationId)
}

/** The draft as the person reads it now. */
export const withDraftRead = (
  read: ReadonlyMap<NoteId, DraftAsShown>,
  draft: AsRead.Note,
): ReadonlyMap<NoteId, DraftAsShown> => new Map(read).set(draft.id, asRead(draft))

export const asRead = (draft: AsRead.Note): DraftAsShown => ({
  body: draft.body,
  conversationId: draft.conversationId,
})
