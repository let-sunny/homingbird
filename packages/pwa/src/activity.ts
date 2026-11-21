import type { AsRead, ConversationId } from '@homingbird/protocol'
import type { Thread } from './state.ts'

/**
 * The conversations whose notes the activity panel needs and the page has not loaded yet: those with
 * the person's drafts, and those with notes unread or waiting for their reply, where their agent may
 * have skipped one. Archived rooms and conversations already on their way are left out.
 */
export const threadsForActivity = (
  conversations: ReadonlyArray<AsRead.Conversation>,
  threads: ReadonlyMap<ConversationId, Thread>,
  awaitingReply: ReadonlyArray<ConversationId>,
  loading: ReadonlySet<ConversationId>,
): ConversationId[] => {
  const waiting = new Set(awaitingReply)
  return conversations
    .filter(
      (room) =>
        room.archivedAt === null && (room.draftCount > 0 || room.unreadCount > 0 || waiting.has(room.id)),
    )
    .map((room) => room.id)
    .filter((id) => !threads.has(id) && !loading.has(id))
}
