import type { AsRead, NoteId } from '@homingbird/protocol'
import type { HeldDecision, HeldWords } from './state.ts'
import { strings } from './strings.ts'

/**
 * The line a draft or answer shows in its own place while a decision on it is held: what is happening,
 * and Undo while it can still be undone. Null when no decision is held on any of the notes.
 */
export const heldLineFor = (held: ReadonlyArray<HeldShown>, ids: ReadonlyArray<NoteId>): HeldLine | null => {
  const decision = held.find((one) => ids.includes(one.noteId))
  return decision === undefined
    ? null
    : {
        noteId: decision.noteId,
        className: `held-line is-${decision.kind}`,
        text: decision.phase === 'done' ? decision.words.done : decision.words.pending,
        undo: decision.phase === 'waiting' ? strings.undo : null,
      }
}

/** The one held decision that can still be undone, if any. */
export const undoableHeld = <Decision extends Pick<HeldDecision, 'phase'>>(
  held: ReadonlyArray<Decision>,
): Decision | null => held.find((one) => one.phase === 'waiting') ?? null

/** The answers waiting for review, less those a held decision decides, which no longer wait. */
export const reviewsWithoutHeld = (
  reviews: ReadonlyArray<AsRead.Review>,
  held: ReadonlyArray<Pick<HeldDecision, 'noteId'>>,
): ReadonlyArray<AsRead.Review> =>
  held.length === 0 ? reviews : reviews.filter((review) => !held.some((one) => one.noteId === review.note.id))

/**
 * The conversations with each one's count of the person's drafts lowered by what a held decision settles,
 * until the server's own count follows once it is carried out.
 */
export const conversationsWithoutHeld = (
  conversations: ReadonlyArray<AsRead.Conversation>,
  held: ReadonlyArray<Pick<HeldDecision, 'conversationId' | 'settles' | 'phase'>>,
): ReadonlyArray<AsRead.Conversation> => {
  const settling = held.filter((one) => one.phase !== 'done' && one.settles > 0)
  if (settling.length === 0) return conversations
  return conversations.map((room) => {
    const settled = settling
      .filter((one) => one.conversationId === room.id)
      .reduce((sum, one) => sum + one.settles, 0)
    return settled === 0 ? room : { ...room, draftCount: Math.max(0, room.draftCount - settled) }
  })
}

/** What a send to these people or this channel, and a discard, are called while held and after. */
export const heldWordsFor = (names: string): HeldChoices => ({
  send: {
    pending: strings.heldSending({ names }),
    done: strings.heldSent({ names }),
    notDone: strings.heldNotSent({ names }),
  },
  discard: {
    pending: strings.heldDiscarding,
    done: strings.heldDiscarded,
    notDone: strings.heldNotDiscarded,
  },
})

/** The line a card shows when the person edited it and has not sent the edit, which Edit opens again. */
export const keptEditLine = (edits: ReadonlyMap<NoteId, string>, noteId: NoteId): string | null =>
  edits.has(noteId) ? strings.draftEditKept : null

export interface HeldChoices {
  readonly send: HeldWords
  readonly discard: HeldWords
}

/** What a held decision shows of itself; its task is not needed to draw it. */
export type HeldShown = Pick<HeldDecision, 'noteId' | 'kind' | 'phase' | 'words'>

export interface HeldLine {
  readonly noteId: NoteId
  readonly className: string
  readonly text: string
  readonly undo: string | null
}
