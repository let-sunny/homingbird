import type { Conversation } from '@homingbird/protocol'
import { parseRoute } from './routes.ts'

export const mostRecentConversation = (conversations: ReadonlyArray<Conversation>): Conversation | null => {
  const live = conversations.filter((conversation) => conversation.archivedAt === null)
  const withNotes = live.filter(
    (conversation) => conversation.lastNote !== null || conversation.draftCount > 0,
  )
  return latest(withNotes.length > 0 ? withNotes : live)
}

/** The last conversation reopens only while the page still shows home: a route the person chose wins. */
export const mayRestoreConversation = (hash: string): boolean => parseRoute(hash).name === 'home'

const latest = (conversations: ReadonlyArray<Conversation>): Conversation | null =>
  conversations.reduce<Conversation | null>(
    (found, conversation) =>
      found === null || conversation.lastActivityAt > found.lastActivityAt ? conversation : found,
    null,
  )
