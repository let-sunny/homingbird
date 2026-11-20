import { Task as T } from '@homingbird/kernel'
import type { Conversation, ConversationId, MemberId, NotFound } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { conversationFor, participatedConversation } from './conversations.ts'

/**
 * Mutes a conversation the viewer takes part in, or lifts the mute. A muted conversation still delivers
 * and counts its unread notes; it only stops pushing notifications to this one person.
 */
export const setMuted = (
  viewerId: MemberId,
  conversationId: ConversationId,
  muted: boolean,
): T.Task<Conversation, NotFound, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    yield* participatedConversation(viewerId, conversationId)
    const mutedAt = muted ? env.clock.now() : null
    yield* run(sql`
      UPDATE participants SET muted_at = ${mutedAt}
      WHERE conversation_id = ${conversationId} AND member_id = ${viewerId}`)
    return yield* conversationFor(viewerId, conversationId, true)
  })
