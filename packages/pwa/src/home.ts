import type { Conversation } from '@homingbird/protocol'

export const mostRecentConversation = (conversations: ReadonlyArray<Conversation>): Conversation | null => {
  const live = conversations.filter((conversation) => conversation.archivedAt === null)
  const withNotes = live.filter(
    (conversation) => conversation.lastNote !== null || conversation.draftCount > 0,
  )
  return latest(withNotes.length > 0 ? withNotes : live)
}

const latest = (conversations: ReadonlyArray<Conversation>): Conversation | null =>
  conversations.reduce<Conversation | null>(
    (found, conversation) =>
      found === null || conversation.lastActivityAt > found.lastActivityAt ? conversation : found,
    null,
  )
