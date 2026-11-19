import { Task as T } from '@homingbird/kernel'
import type { ConversationId } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'

/** The clock's time, or just after the conversation's latest sent note, so sent notes keep a strict order. */
export const nextSendTime = (
  conversationId: ConversationId,
  clockTime: number,
): T.Task<number, never, AppEnv> =>
  T.map((latest: { sent_at: number | null } | null) => Math.max(clockTime, Number(latest?.sent_at ?? 0) + 1))(
    first(
      sql`SELECT MAX(sent_at) AS sent_at FROM notes WHERE conversation_id = ${conversationId} AND status = 'sent'`,
    ),
  )
