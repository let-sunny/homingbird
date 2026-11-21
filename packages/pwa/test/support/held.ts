import { Task as T } from '@homingbird/kernel'
import { heldWordsFor } from '../../src/held-decisions.ts'
import type { HeldDecision } from '../../src/state.ts'
import { ROOM } from './fixtures.ts'

/** A send to Ben held a moment, waiting to be carried out unless the fields say otherwise. */
export const heldDecision = (noteId: string, fields: Partial<HeldDecision> = {}): HeldDecision => {
  const kind = fields.kind ?? 'send'
  return {
    noteId: noteId as never,
    conversationId: ROOM,
    kind,
    review: false,
    settles: 1,
    words: heldWordsFor('Ben')[kind],
    run: T.unit,
    phase: 'waiting',
    ...fields,
  }
}
