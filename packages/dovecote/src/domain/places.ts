import { Task as T } from '@homingbird/kernel'
import type { ConversationId, PlaceName } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { first } from '../sql/database.ts'
import { type Query, raw, sql } from '../sql/query.ts'

/** A conversation's place: its channel, an archived channel by its old name, or null for direct and group messages. */
export const placeOfConversation = (conversationId: ConversationId): T.Task<PlaceName, never, AppEnv> =>
  T.map((row: PlaceRow | null) => (row === null ? null : placeOf(row)))(
    first<PlaceRow>(sql`SELECT ${PLACE_COLUMNS} FROM conversations c
      LEFT JOIN channels ch ON ch.conversation_id = c.id WHERE c.id = ${conversationId}`),
  )

export const placeOf = (row: PlaceRow): PlaceName =>
  row.place_slug ?? (row.place_kind !== 'direct' && row.place_archived_at !== null ? row.place_title : null)

/** Columns naming the place of `n.conversation_id`, to use with `PLACE_JOIN`. */
export const PLACE_COLUMNS: Query = raw(
  'c.kind AS place_kind, c.title AS place_title, c.archived_at AS place_archived_at, ch.slug AS place_slug',
)

export const PLACE_JOIN: Query = raw(
  'JOIN conversations c ON c.id = n.conversation_id LEFT JOIN channels ch ON ch.conversation_id = c.id',
)

export interface PlaceRow {
  readonly place_kind: string
  readonly place_title: string | null
  readonly place_archived_at: number | null
  readonly place_slug: string | null
}
