import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type ConversationId,
  type DraftingPrinciples,
  Invalid,
  type MemberId,
  type MyPrinciples,
  NotFound,
  PRINCIPLES_PER_PERSON,
  type PlaceName,
  type Principle,
  type PrincipleId,
  type PrincipleKind,
  type PrincipleOrigin,
  type TaughtFrom,
  isSameTitle,
  isUnchangedSuggestion,
  principleProblem,
  problemMessage,
  publicTextProblem,
  selectPrinciples,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { first, inTransaction, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { clearAutoSend } from './auto-send-settings.ts'
import { participatedConversation } from './conversations.ts'
import { myPrinciples } from './my-principles.ts'
import { placeOfConversation } from './places.ts'
import { openOffer, suggestionOf } from './principle-offers.ts'
import { ownPrinciple, principlesOf, withFigures } from './principle-rows.ts'

export interface PrincipleDraft {
  readonly kind?: PrincipleKind | undefined
  readonly topic: string
  readonly rule: string
  readonly source?: string | null | undefined
  readonly place: PlaceName
  readonly publicText?: string | null | undefined
  readonly offerId?: string | undefined
  readonly confirmed?: boolean | undefined
  readonly taughtFrom?: TaughtFrom | undefined
  /** Where a proposal the person saved came from. */
  readonly origin?: PrincipleOrigin | undefined
}

/**
 * Saves a principle the person wrote, for a channel they are in or for everywhere. From an offer, the
 * person must have changed it or confirmed it. The limit holds under concurrent saves: the member's row
 * is locked first and the insert itself counts.
 */
export const createPrinciple = (
  memberId: MemberId,
  draft: PrincipleDraft,
): T.Task<Principle, Invalid | Conflict | NotFound, AppEnv> =>
  inTransaction(
    T.gen(function* () {
      const env = yield* T.ask<AppEnv>()
      const kind = draft.kind ?? 'rule'
      const topic = draft.topic.trim()
      const rule = draft.rule.trim()
      const source = draft.source ?? null
      const publicText = draft.publicText?.trim() ?? null
      yield* requireSavable({ kind, topic, rule, source, place: draft.place }, publicText)
      const offer = draft.offerId === undefined ? null : yield* openOffer(memberId, draft.offerId)
      if (offer === null || offer.place !== draft.place) yield* requireChannelOf(memberId, draft.place)
      yield* run(sql`UPDATE members SET event_seq = event_seq WHERE id = ${memberId}`)
      yield* requireUniqueTitle(yield* principlesOf(memberId), topic, null)
      const suggestion = offer === null ? null : suggestionOf(offer)
      if (suggestion !== null && isUnchangedSuggestion(suggestion, rule) && draft.confirmed !== true)
        return yield* T.fail(
          Invalid({ message: 'Change the suggested principle, or confirm that it says what you mean.' }),
        )
      const now = env.clock.now()
      const id = `prin_${env.random.identifier()}` as PrincipleId
      const origin: PrincipleOrigin =
        offer === null
          ? (draft.origin ?? draft.taughtFrom ?? 'manual')
          : offer.kind === 'edit'
            ? 'edit'
            : 'discard'
      const inserted = yield* run(sql`
        INSERT INTO principles (id, member_id, kind, topic, rule, source, place, enabled, origin, position,
          created_at, updated_at, last_applied_at, public_text)
        SELECT ${id}, ${memberId}, ${kind}, ${topic}, ${rule}, ${source}, ${draft.place}, 1, ${origin},
          counted.next_position, ${now}, ${now}, NULL, ${publicText}
        FROM (SELECT COUNT(*) AS total, COALESCE(MAX(position) + 1, 0) AS next_position
          FROM principles WHERE member_id = ${memberId}) counted
        WHERE counted.total < ${PRINCIPLES_PER_PERSON}`)
      if (inserted === 0)
        return yield* T.fail(
          Conflict({
            message: `You can keep ${PRINCIPLES_PER_PERSON} principles. Delete one you no longer need first.`,
          }),
        )
      if (offer !== null)
        yield* run(sql`UPDATE principle_offers SET closed_at = ${now} WHERE id = ${offer.id}`)
      return yield* withFigures(yield* ownPrinciple(memberId, id))
    }),
  )

export const updatePrinciple = (
  memberId: MemberId,
  id: string,
  change: {
    readonly kind?: PrincipleKind | undefined
    readonly topic?: string | undefined
    readonly rule?: string | undefined
    readonly source?: string | null | undefined
    readonly enabled?: boolean | undefined
    readonly publicText?: string | null | undefined
  },
): T.Task<Principle, Invalid | Conflict | NotFound, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const current = yield* ownPrinciple(memberId, id)
    const kind = change.kind ?? current.kind
    const topic = change.topic?.trim() ?? current.topic
    const rule = change.rule?.trim() ?? current.rule
    const source = change.source === undefined ? current.source : change.source
    const publicText =
      change.publicText === undefined ? current.publicText : (change.publicText?.trim() ?? null)
    if (isEdit(change)) yield* requireSavable({ kind, topic, rule, source, place: current.place }, publicText)
    yield* requireUniqueTitle(yield* principlesOf(memberId), topic, current.id)
    const enabled = change.enabled ?? current.enabled
    if (kind !== 'answer') yield* clearAutoSend(current.id)
    yield* run(sql`UPDATE principles SET kind = ${kind}, topic = ${topic}, rule = ${rule}, source = ${source},
      enabled = ${enabled ? 1 : 0}, public_text = ${publicText}, updated_at = ${env.clock.now()}
      WHERE id = ${id} AND member_id = ${memberId}`)
    return yield* withFigures(yield* ownPrinciple(memberId, id))
  })

/** Puts the person's principles in the order they chose: the order of priority in every draft's instructions. */
export const reorderPrinciples = (
  memberId: MemberId,
  ids: ReadonlyArray<string>,
): T.Task<MyPrinciples, Invalid, AppEnv> =>
  T.flatMap(() => myPrinciples(memberId))(orderPrinciples(memberId, ids))

/** Gives a member's principles the positions of `ids`, which must name each of them once. */
export const orderPrinciples = (
  memberId: MemberId,
  ids: ReadonlyArray<string>,
): T.Task<void, Invalid, AppEnv> =>
  T.gen(function* () {
    const existing = yield* principlesOf(memberId)
    const known = new Set(existing.map((principle) => principle.id as string))
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id)))
      return yield* T.fail(
        Invalid({ message: 'Give every one of your principles once, in the order you want.' }),
      )
    for (const [position, id] of ids.entries())
      yield* run(
        sql`UPDATE principles SET position = ${position} WHERE id = ${id} AND member_id = ${memberId}`,
      )
  })

export const deletePrinciple = (memberId: MemberId, id: string): T.Task<Principle, NotFound, AppEnv> =>
  T.gen(function* () {
    const principle = yield* ownPrinciple(memberId, id)
    yield* run(sql`DELETE FROM principle_applications WHERE principle_id = ${id}`)
    yield* clearAutoSend(principle.id)
    yield* run(sql`DELETE FROM principles WHERE id = ${id} AND member_id = ${memberId}`)
    return yield* withFigures(principle)
  })

/** What one draft's instructions carry: fetched for each draft, so every desk follows the current set. */
export const principlesForDrafting = (
  memberId: MemberId,
  conversationId: ConversationId | undefined,
): T.Task<DraftingPrinciples, Invalid, AppEnv> =>
  T.gen(function* () {
    if (conversationId === undefined) return selectPrinciples(yield* principlesOf(memberId))
    yield* T.catchTag('NotFound', () => T.fail(Invalid({ message: NOT_IN_CONVERSATION })))(
      participatedConversation(memberId, conversationId),
    )
    return selectPrinciples(yield* principlesOf(memberId), yield* placeOfConversation(conversationId))
  })

/** A channel renamed by an administrator keeps its principles, offers and proposals under the new name. */
export const renamePlace = (from: string, to: string): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    yield* run(sql`UPDATE principles SET place = ${to} WHERE place = ${from}`)
    yield* run(sql`UPDATE principle_offers SET place = ${to} WHERE place = ${from}`)
    yield* run(sql`UPDATE principle_quiet_places SET place = ${to} WHERE place = ${from}`)
    yield* run(sql`UPDATE principle_proposals SET place = ${to} WHERE place = ${from}`)
  })

/** A principle may name a channel only while its person is in it. */
export const requireChannelOf = (memberId: MemberId, place: PlaceName): T.Task<void, NotFound, AppEnv> =>
  T.gen(function* () {
    if (place === null) return
    const found = yield* first(sql`SELECT ch.slug FROM channels ch
      JOIN participants p ON p.conversation_id = ch.conversation_id AND p.member_id = ${memberId}
      WHERE ch.slug = ${place}`)
    if (found === null)
      return yield* T.fail(NotFound({ message: 'You can save a principle only for a channel you are in.' }))
  })

/** Not NotFound, which a desk reads as the feature being switched off. */
const NOT_IN_CONVERSATION = 'You are not in that conversation, so there are no principles to give for it.'

/**
 * Whether a change touches what an item says. Turning one on or off is not an edit, so a stored answer
 * longer than the cap keeps working until its person edits it, and the edit must fit.
 */
const isEdit = (change: Readonly<Record<string, unknown>>): boolean =>
  Object.entries(change).some(([key, value]) => key !== 'enabled' && value !== undefined)

const requireSavable = (
  item: {
    readonly kind: PrincipleKind
    readonly topic: string
    readonly rule: string
    readonly source: string | null
    readonly place: PlaceName
  },
  publicText: string | null,
): T.Task<void, Invalid> => {
  const problem = principleProblem(item) ?? (publicText === null ? null : publicTextProblem(publicText, item))
  return problem === null ? T.unit : T.fail(Invalid({ message: problemMessage(problem) }))
}

const requireUniqueTitle = (
  existing: ReadonlyArray<Principle>,
  topic: string,
  except: PrincipleId | null,
): T.Task<void, Conflict> =>
  existing.some((principle) => principle.id !== except && isSameTitle(principle.topic, topic))
    ? T.fail(
        Conflict({ message: 'You already have a principle with that title. Give this one another title.' }),
      )
    : T.unit
