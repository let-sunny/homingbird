import type { AsRead, ConversationId, NoteId } from '@homingbird/protocol'
import type { HeldDecision, Thread } from './state.ts'

/** What to show while a decision is held: everything but the draft or answer it decides, which looks done. */
export const withoutHeld = <Item>(
  items: ReadonlyArray<Item>,
  held: Pick<HeldDecision, 'noteId'> | null,
  idOf: (item: Item) => NoteId,
): ReadonlyArray<Item> => (held === null ? items : items.filter((item) => idOf(item) !== held.noteId))

/** The conversations as loaded, less the draft a held decision decides. */
export const threadsWithoutHeld = (
  threads: ReadonlyMap<ConversationId, Thread>,
  held: Pick<HeldDecision, 'noteId'> | null,
): ReadonlyMap<ConversationId, Thread> =>
  held === null
    ? threads
    : new Map(
        [...threads].map(([id, thread]) => [
          id,
          { ...thread, notes: withoutHeld(thread.notes, held, noteIdOf) },
        ]),
      )

/** The answers waiting for review, less the one a held decision decides. */
export const reviewsWithoutHeld = (
  reviews: ReadonlyArray<AsRead.Review>,
  held: Pick<HeldDecision, 'noteId'> | null,
): ReadonlyArray<AsRead.Review> => withoutHeld(reviews, held, (review) => review.note.id)

const noteIdOf = (note: AsRead.Note): NoteId => note.id
