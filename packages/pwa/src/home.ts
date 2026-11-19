import type { AsRead } from '@homingbird/protocol'
import { parseRoute } from './routes.ts'

export const mostRecentConversation = (
  conversations: ReadonlyArray<AsRead.Conversation>,
): AsRead.Conversation | null => {
  const live = conversations.filter((conversation) => conversation.archivedAt === null)
  const withNotes = live.filter(
    (conversation) => conversation.lastNote !== null || conversation.draftCount > 0,
  )
  return latest(withNotes.length > 0 ? withNotes : live)
}

/** The last conversation reopens only while the page still shows home: a route the person chose wins. */
export const mayRestoreConversation = (hash: string): boolean => parseRoute(hash).name === 'home'

const latest = (conversations: ReadonlyArray<AsRead.Conversation>): AsRead.Conversation | null =>
  conversations.reduce<AsRead.Conversation | null>(
    (found, conversation) =>
      found === null || conversation.lastActivityAt > found.lastActivityAt ? conversation : found,
    null,
  )
