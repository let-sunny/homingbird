import type { Conversation, MemberId } from '@homingbird/protocol'

/**
 * Tells which conversation rows just received a note from someone else, so that only those animate. A
 * conversation seen for the first time counts only if its note was sent after `since`: a page load
 * animates nothing. A row redrawn while its arrival is still playing keeps it, so an unrelated redraw
 * cannot cut the animation short.
 */
export const arrivalTracker = (
  since: number,
  now: () => number,
): ((conversation: Conversation, viewerId: MemberId) => boolean) => {
  const lastSeen = new Map<string, string | null>()
  const arrivedAt = new Map<string, number>()
  return (conversation, viewerId) => {
    const latest = conversation.lastNote
    const known = lastSeen.has(conversation.id)
    const previous = lastSeen.get(conversation.id) ?? null
    lastSeen.set(conversation.id, latest?.id ?? null)
    const isNew = known ? latest?.id !== previous : (latest?.sentAt ?? 0) > since
    if (latest === null || latest.authorId === viewerId) return false
    if (isNew) arrivedAt.set(conversation.id, now())
    const at = arrivedAt.get(conversation.id)
    return at !== undefined && now() - at < ARRIVAL_PLAYS_MS
  }
}

export const ARRIVAL_PLAYS_MS = 2000
