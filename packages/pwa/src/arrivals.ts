import type { Conversation, MemberId } from '@homingbird/protocol'

/**
 * Tells which conversation rows just received a note from someone else, so that only those animate. A
 * conversation seen for the first time counts only if its note was sent after `since`: a page load
 * animates nothing.
 */
export const arrivalTracker = (
  since: number,
): ((conversation: Conversation, viewerId: MemberId) => boolean) => {
  const lastSeen = new Map<string, string | null>()
  return (conversation, viewerId) => {
    const latest = conversation.lastNote
    const known = lastSeen.has(conversation.id)
    const previous = lastSeen.get(conversation.id) ?? null
    lastSeen.set(conversation.id, latest?.id ?? null)
    const isNew = known ? latest?.id !== previous : (latest?.sentAt ?? 0) > since
    return latest !== null && isNew && latest.authorId !== viewerId
  }
}
