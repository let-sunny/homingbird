import { Task as T } from '@homingbird/kernel'
import {
  type ConversationId,
  type MemberId,
  NotFound,
  type NoteId,
  type PlaceName,
  type PrincipleOffer,
  type SuggestedChange,
  isSubstantialEdit,
  suggestedChange,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, insertInto, sql } from '../sql/query.ts'
import type { NoteRow } from './note-rows.ts'
import { placeOfConversation } from './places.ts'
import { featureIsOn } from './settings.ts'
import { DAY_MS } from './trust-figures.ts'

/**
 * After a person sent an agent's draft with a substantial edit, or discarded one, offers a chance to
 * teach: at most once a day per channel, or per direct or group conversation, and never where the
 * person said not to ask. The suggestion comes from the draft and the sent text only.
 */
export const offerAfterDecision = (draft: NoteRow, sentBody: string | null): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const agentText = draft.agent_body
    if (draft.agent_name === null || agentText === null || draft.debate_id) return
    if (sentBody !== null && !isSubstantialEdit(agentText, sentBody)) return
    if (!(yield* featureIsOn('teaching'))) return
    const place = yield* placeOfConversation(draft.conversation_id)
    const key = quietKey(place, draft.conversation_id)
    const now = env.clock.now()
    const quiet = yield* first(
      sql`SELECT place FROM principle_quiet_places WHERE member_id = ${draft.author_id} AND place = ${key}`,
    )
    if (quiet !== null) return
    const recent = yield* all<{ place: string | null; conversation_id: ConversationId }>(sql`
      SELECT place, conversation_id FROM principle_offers
      WHERE member_id = ${draft.author_id} AND created_at > ${now - DAY_MS}`)
    if (recent.some((offer) => quietKey(offer.place, offer.conversation_id) === key)) return
    yield* run(
      insertInto('principle_offers', {
        id: `offer_${env.random.identifier()}`,
        member_id: draft.author_id,
        note_id: draft.id,
        conversation_id: draft.conversation_id,
        place,
        kind: sentBody === null ? 'discard' : 'edit',
        suggested_change: changeToStore(sentBody === null ? null : suggestedChange(agentText, sentBody)),
        created_at: now,
        closed_at: null,
      }),
    )
  })

export const dismissOffer = (
  memberId: MemberId,
  id: string,
  stopAskingHere: boolean,
): T.Task<void, NotFound, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const offer = yield* openOffer(memberId, id)
    yield* run(sql`UPDATE principle_offers SET closed_at = ${env.clock.now()} WHERE id = ${offer.id}`)
    if (stopAskingHere)
      yield* run(
        insertIgnoringConflict(yield* dialect, 'principle_quiet_places', {
          member_id: memberId,
          place: quietKey(offer.place, offer.conversation_id),
          created_at: env.clock.now(),
        }),
      )
  })

export const openOffers = (memberId: MemberId): T.Task<PrincipleOffer[], never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const rows = yield* all<OfferRow>(sql`SELECT * FROM principle_offers
      WHERE member_id = ${memberId} AND closed_at IS NULL AND created_at > ${env.clock.now() - OFFERS_KEPT_MS}
      ORDER BY created_at DESC, id LIMIT ${OFFERS_SHOWN}`)
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      noteId: row.note_id,
      conversationId: row.conversation_id,
      place: row.place,
      suggestion: suggestionOf(row),
      createdAt: Number(row.created_at),
    }))
  })

export const openOffer = (memberId: MemberId, id: string): T.Task<OfferRow, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* first<OfferRow>(
      sql`SELECT * FROM principle_offers WHERE id = ${id} AND member_id = ${memberId} AND closed_at IS NULL`,
    )
    if (row === null) return yield* T.fail(NotFound({ message: 'That chance to teach is no longer open.' }))
    return row
  })

export const suggestionOf = (row: Pick<OfferRow, 'suggested_change'>): SuggestedChange | null => {
  if (row.suggested_change === null) return null
  const { added, removed } = JSON.parse(row.suggested_change) as SuggestedChange
  return { added, removed }
}

export interface OfferRow {
  readonly id: string
  readonly note_id: NoteId
  readonly conversation_id: ConversationId
  readonly place: string | null
  readonly kind: 'edit' | 'discard'
  readonly suggested_change: string | null
  readonly created_at: number
}

const OFFERS_SHOWN = 20
const OFFERS_KEPT_MS = 14 * DAY_MS

/** A channel is keyed by its name, so a rename carries over; a direct or group conversation by its id. */
const quietKey = (place: PlaceName, conversationId: ConversationId): string =>
  place ?? `conversation:${conversationId}`

const changeToStore = (change: SuggestedChange | null): string | null =>
  change === null ? null : JSON.stringify({ added: change.added, removed: change.removed })
