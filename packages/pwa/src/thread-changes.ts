import type { ConversationId } from '@homingbird/protocol'

/** Counts changes to each conversation, so that a snapshot older than a change never replaces it. */
export const changeCounter = (): ChangeCounter => {
  const counts = new Map<ConversationId, number>()
  const changesTo = (id: ConversationId): number => counts.get(id) ?? 0
  return {
    changesTo,
    count: (id) => void counts.set(id, changesTo(id) + 1),
    forget: () => counts.clear(),
    changedSince: (id, before) => changesTo(id) !== before,
  }
}

export interface ChangeCounter {
  readonly changesTo: (id: ConversationId) => number
  readonly count: (id: ConversationId) => void
  /** Forgets every conversation, as when the session that counted them ended. */
  readonly forget: () => void
  /** Whether something changed the conversation while a snapshot of it was on its way. */
  readonly changedSince: (id: ConversationId, before: number) => boolean
}
