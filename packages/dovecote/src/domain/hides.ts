import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type Conversation,
  type ConversationId,
  type MemberId,
  type NotFound,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { conversationFor, participatedConversation } from './conversations.ts'

/** Hides a direct or group message from the viewer's own list only, or shows it again. */
export const setHidden = (
  viewerId: MemberId,
  conversationId: ConversationId,
  hidden: boolean,
): T.Task<Conversation, NotFound | Conflict, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const room = yield* participatedConversation(viewerId, conversationId)
    if (room.kind === 'channel' || (room.channel_id ?? null) !== null) return yield* T.fail(NOT_HIDEABLE)
    yield* run(sql`
      UPDATE participants SET hidden_at = ${hidden ? env.clock.now() : null}
      WHERE conversation_id = ${conversationId} AND member_id = ${viewerId}`)
    return yield* conversationFor(viewerId, conversationId, true)
  })

const NOT_HIDEABLE = Conflict({
  message: 'Only a direct or group message can be hidden. Leave a channel, or mute it, from its menu.',
})
