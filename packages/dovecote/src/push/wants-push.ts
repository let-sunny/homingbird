import { Task as T } from '@homingbird/kernel'
import type { ConversationId, ConversationKind, MemberId } from '@homingbird/protocol'
import { type ChosenLevel, levelIn } from '../domain/notification-level.ts'
import { featureIsOn } from '../domain/settings.ts'
import type { AppEnv } from '../environment.ts'
import { first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'

/** Whether a person wants a push about a conversation they are in; decided here, whatever the client. */
export const wantsPushAbout = (
  memberId: MemberId,
  conversationId: ConversationId,
): T.Task<boolean, never, AppEnv> =>
  T.gen(function* () {
    const place = yield* first<PlaceRow>(sql`
      SELECT c.kind, c.channel_id, c.asked_by, p.muted_at, m.notifications FROM participants p
      JOIN conversations c ON c.id = p.conversation_id
      JOIN members m ON m.id = p.member_id
      WHERE p.conversation_id = ${conversationId} AND p.member_id = ${memberId}`)
    if (place === null) return false
    if (!(yield* featureIsOn('mute'))) return true
    return isPushWanted({
      kind: kindFor(memberId, place),
      muted: place.muted_at !== null,
      level: levelIn(place.notifications),
    })
  })

export const isPushWanted = (place: {
  readonly kind: ConversationKind
  readonly muted: boolean
  readonly level: ChosenLevel
}): boolean => {
  if (place.muted || place.level === 'none') return false
  return place.level === 'all' || place.kind !== 'channel'
}

/** A private question notifies its asker as their own conversation, and its managers as the channel. */
const kindFor = (memberId: MemberId, place: PlaceRow): ConversationKind =>
  place.channel_id !== null && place.asked_by !== memberId ? 'channel' : place.kind

interface PlaceRow {
  readonly kind: ConversationKind
  readonly channel_id: ConversationId | null
  readonly asked_by: MemberId | null
  readonly muted_at: number | null
  readonly notifications: string | null
}
