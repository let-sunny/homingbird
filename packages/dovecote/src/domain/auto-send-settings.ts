import { Task as T } from '@homingbird/kernel'
import {
  type AutoSend,
  type ConversationId,
  Invalid,
  type MemberId,
  type NotFound,
  type Principle,
  type PrincipleId,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all, run } from '../sql/database.ts'
import { insertInto, list, sql } from '../sql/query.ts'
import { agentAnsweringIn } from './channel-rows.ts'
import { ownPrinciple, withFigures } from './principle-rows.ts'

/** Switches a saved answer with its own text to send itself, or not, and says where it may. */
export const setAutoSend = (
  memberId: MemberId,
  id: string,
  setting: AutoSend,
): T.Task<Principle, Invalid | NotFound, AppEnv> =>
  T.gen(function* () {
    const principle = yield* ownPrinciple(memberId, id)
    const places = [...new Set(setting.places)]
    if (setting.enabled && (principle.kind !== 'answer' || principle.rule.trim() === ''))
      return yield* T.fail(Invalid({ message: 'Only a saved answer with its own text can send itself.' }))
    if (setting.enabled && places.length === 0)
      return yield* T.fail(
        Invalid({ message: 'Choose at least one place where this answer may send itself.' }),
      )
    const eligible = new Set(yield* autoSendPlacesAmong(memberId, places))
    if (places.some((place) => !eligible.has(place)))
      return yield* T.fail(
        Invalid({
          message:
            'A saved answer can send itself only in a direct conversation or an open channel you are in, and never in a channel with its own agent: its managers review every answer there.',
        }),
      )
    yield* run(
      sql`UPDATE principles SET auto_send = ${setting.enabled ? 1 : 0} WHERE id = ${id} AND member_id = ${memberId}`,
    )
    yield* run(sql`DELETE FROM principle_auto_send_places WHERE principle_id = ${id}`)
    for (const place of places)
      yield* run(insertInto('principle_auto_send_places', { principle_id: id, conversation_id: place }))
    return yield* withFigures(yield* ownPrinciple(memberId, id))
  })

export const clearAutoSend = (id: PrincipleId): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    yield* run(sql`UPDATE principles SET auto_send = 0 WHERE id = ${id}`)
    yield* run(sql`DELETE FROM principle_auto_send_places WHERE principle_id = ${id}`)
  })

/**
 * Of these conversations, the member's unarchived direct ones and open channels' rooms; a private
 * channel, a group message, a private question and a channel whose own agent answers have no door.
 */
export const autoSendPlacesAmong = (
  memberId: MemberId,
  ids: ReadonlyArray<ConversationId>,
): T.Task<ConversationId[], never, AppEnv> =>
  T.gen(function* () {
    if (ids.length === 0) return []
    const rows = yield* all<{ id: ConversationId }>(sql`
      SELECT c.id FROM conversations c
      JOIN participants p ON p.conversation_id = c.id AND p.member_id = ${memberId}
      LEFT JOIN channels ch ON ch.conversation_id = c.id
      WHERE c.id IN ${list(ids)} AND c.archived_at IS NULL
      AND (c.kind = 'direct' OR (c.kind = 'channel' AND ch.slug IS NOT NULL AND COALESCE(ch.visibility, 'open') = 'open'))`)
    const places: ConversationId[] = []
    for (const row of rows) if ((yield* agentAnsweringIn(row.id)) === null) places.push(row.id)
    return places
  })
