import type { ConversationId } from '@homingbird/protocol'

/**
 * How many times a conversation's notes changed in this page, by a live event or by the person's own
 * action. A load whose snapshot was requested before a change must not replace the newer notes.
 */
export const changesTo = (id: ConversationId): number => counts.get(id) ?? 0

export const countChange = (id: ConversationId): void => {
  counts.set(id, changesTo(id) + 1)
}

/** Whether something changed the conversation while a snapshot of it was on its way. */
export const changedSince = (id: ConversationId, before: number): boolean => changesTo(id) !== before

const counts = new Map<ConversationId, number>()
