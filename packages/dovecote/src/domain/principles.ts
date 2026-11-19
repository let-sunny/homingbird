import { Task as T } from '@homingbird/kernel'
import {
  type Achievement,
  Conflict,
  type ConversationId,
  type DraftingPrinciples,
  Invalid,
  type MemberId,
  type MyPrinciples,
  NotFound,
  type NoteId,
  PRINCIPLES_PER_PERSON,
  type PlaceName,
  type Principle,
  type PrincipleCounts,
  type PrincipleId,
  type PrincipleKind,
  type PrincipleOffer,
  type PrincipleOrigin,
  type RoutePoint,
  type SuggestedChange,
  appliedTitlesIn,
  isSameTitle,
  isSubstantialEdit,
  isUnchangedSuggestion,
  principleProblem,
  problemMessage,
  publicTextProblem,
  selectPrinciples,
  suggestedChange,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all, dialect, first, inTransaction, run } from '../sql/database.ts'
import { insertIgnoringConflict, insertInto, list, sql } from '../sql/query.ts'
import { participatedConversation } from './conversations.ts'
import { debateAchievementsOf, debateCreditsOf } from './debate-credits.ts'
import { agentReportFor } from './insights.ts'
import type { NoteRow } from './note-rows.ts'
import { PLACE_COLUMNS, PLACE_JOIN, type PlaceRow, placeOf, placeOfConversation } from './places.ts'
import { featureIsOn } from './settings.ts'
import { DAY_MS } from './trust-figures.ts'

/** Everything the person taught their agent: principles, open chances to teach, the route map, achievements. */
export const myPrinciples = (memberId: MemberId): T.Task<MyPrinciples, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const principles = yield* principlesOf(memberId)
    const figures = yield* featureIsOn('agentFigures')
    const week = figures ? (yield* agentReportFor(memberId)).periods[0]!.current : null
    const debateCredits = (yield* featureIsOn('debateRooms')) ? yield* debateCreditsOf(memberId) : []
    return {
      principles: principles.map((principle) => shownWith(principle, figures)),
      offers: yield* openOffers(memberId),
      routes: (yield* featureIsOn('routeMap')) ? yield* routeMap(memberId, principles, env.clock.now()) : [],
      achievements: [
        ...(week === null
          ? []
          : achievementsOf(
              principles,
              week.sentAsWritten + week.sentAfterEdits + week.discarded,
              week.quickApprovals,
            )),
        ...debateAchievementsOf(debateCredits),
      ],
      debateCredits,
      limit: PRINCIPLES_PER_PERSON,
    }
  })

export interface PrincipleDraft {
  readonly kind?: PrincipleKind | undefined
  readonly topic: string
  readonly rule: string
  readonly source?: string | null | undefined
  readonly place: PlaceName
  readonly publicText?: string | null | undefined
  readonly offerId?: string | undefined
  readonly confirmed?: boolean | undefined
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
      const origin: PrincipleOrigin = offer === null ? 'manual' : offer.kind === 'edit' ? 'edit' : 'discard'
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
    yield* requireSavable({ kind, topic, rule, source, place: current.place }, publicText)
    yield* requireUniqueTitle(yield* principlesOf(memberId), topic, current.id)
    const enabled = change.enabled ?? current.enabled
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
    return yield* myPrinciples(memberId)
  })

export const deletePrinciple = (memberId: MemberId, id: string): T.Task<Principle, NotFound, AppEnv> =>
  T.gen(function* () {
    const principle = yield* ownPrinciple(memberId, id)
    yield* run(sql`DELETE FROM principle_applications WHERE principle_id = ${id}`)
    yield* run(sql`DELETE FROM principles WHERE id = ${id} AND member_id = ${memberId}`)
    return yield* withFigures(principle)
  })

/** "This principle was wrong here": a miss against a principle the draft said it applied. */
export const recordMiss = (
  memberId: MemberId,
  id: string,
  noteId: NoteId,
): T.Task<Principle, NotFound, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    yield* ownPrinciple(memberId, id)
    const changed = yield* run(sql`UPDATE principle_applications SET missed_at = ${env.clock.now()}
      WHERE principle_id = ${id} AND note_id = ${noteId} AND member_id = ${memberId} AND missed_at IS NULL`)
    if (changed === 0) {
      const applied = yield* first(
        sql`SELECT note_id FROM principle_applications WHERE principle_id = ${id} AND note_id = ${noteId}`,
      )
      if (applied === null)
        return yield* T.fail(NotFound({ message: 'That draft did not say it applied this principle.' }))
    }
    return yield* withFigures(yield* ownPrinciple(memberId, id))
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

/**
 * Links a draft to the principles its basis says it applied, by title. A revised basis replaces the
 * draft's earlier claims; a claim it keeps keeps its "wrong here" mark.
 */
export const recordApplications = (
  memberId: MemberId,
  noteId: NoteId,
  basis: string | null,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (!(yield* featureIsOn('teaching'))) return
    const titles = appliedTitlesIn(basis)
    const applied = (yield* principlesOf(memberId)).filter(
      (principle) => principle.enabled && titles.some((title) => isSameTitle(title, principle.topic)),
    )
    yield* run(
      applied.length === 0
        ? sql`DELETE FROM principle_applications WHERE note_id = ${noteId} AND member_id = ${memberId}`
        : sql`DELETE FROM principle_applications WHERE note_id = ${noteId} AND member_id = ${memberId}
            AND principle_id NOT IN ${list(applied.map((principle) => principle.id))}`,
    )
    const now = env.clock.now()
    for (const principle of applied) {
      yield* run(
        insertIgnoringConflict(yield* dialect, 'principle_applications', {
          principle_id: principle.id,
          note_id: noteId,
          member_id: memberId,
          created_at: now,
          missed_at: null,
        }),
      )
      yield* run(sql`UPDATE principles SET last_applied_at = ${now} WHERE id = ${principle.id}`)
    }
  })

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

/** The sentences a member made public about their agent, in their order; nothing else of their principles. */
export const agentIntroductionsOf = (
  memberIds: ReadonlyArray<MemberId>,
): T.Task<Map<MemberId, string[]>, never, AppEnv> =>
  T.gen(function* () {
    if (memberIds.length === 0 || !(yield* featureIsOn('teaching'))) return new Map()
    const rows = yield* all<{ member_id: MemberId; public_text: string }>(sql`
      SELECT member_id, public_text FROM principles
      WHERE member_id IN ${list([...new Set(memberIds)])} AND public_text IS NOT NULL AND enabled = 1
      ORDER BY position, created_at, id`)
    const byMember = Map.groupBy(rows, (row) => row.member_id)
    return new Map([...byMember].map(([id, entries]) => [id, entries.map((row) => row.public_text)]))
  })

/** A channel renamed by an administrator keeps its principles and offers under the new name. */
export const renamePlace = (from: string, to: string): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    yield* run(sql`UPDATE principles SET place = ${to} WHERE place = ${from}`)
    yield* run(sql`UPDATE principle_offers SET place = ${to} WHERE place = ${from}`)
    yield* run(sql`UPDATE principle_quiet_places SET place = ${to} WHERE place = ${from}`)
  })

export const achievementsOf = (
  principles: ReadonlyArray<CountedPrinciple>,
  decidedThisWeek: number,
  quickApprovalsThisWeek: number,
): Achievement[] => [
  ...(principles.length > 0 ? (['first_principle'] as const) : []),
  ...(principles.some((principle) => principle.origin === 'discard') ? (['discard_taught'] as const) : []),
  ...(principles.some((principle) => principle.counts.applied >= 10) ? (['ten_applications'] as const) : []),
  ...(decidedThisWeek >= CAREFUL_WEEK_DECISIONS && quickApprovalsThisWeek === 0
    ? (['careful_week'] as const)
    : []),
]

/** Not NotFound, which a desk reads as the feature being switched off. */
const NOT_IN_CONVERSATION = 'You are not in that conversation, so there are no principles to give for it.'

const CAREFUL_WEEK_DECISIONS = 5
const OFFERS_SHOWN = 20
const OFFERS_KEPT_MS = 14 * DAY_MS
const ROUTE_DAYS = 30

interface PrincipleRow {
  readonly id: PrincipleId
  readonly member_id: MemberId
  readonly kind: PrincipleKind
  readonly topic: string
  readonly rule: string
  readonly source: string | null
  readonly place: string | null
  readonly enabled: number
  readonly origin: PrincipleOrigin
  readonly position: number
  readonly created_at: number
  readonly updated_at: number
  readonly last_applied_at: number | null
  readonly public_text: string | null
}

interface ApplicationRow {
  readonly principle_id: PrincipleId
  readonly status: string
  readonly origin: string
  readonly decided_at: number | null
  readonly missed_at: number | null
}

interface OfferRow {
  readonly id: string
  readonly note_id: NoteId
  readonly conversation_id: ConversationId
  readonly place: string | null
  readonly kind: 'edit' | 'discard'
  readonly suggested_change: string | null
  readonly created_at: number
}

/** A channel is keyed by its name, so a rename carries over; a direct or group conversation by its id. */
const quietKey = (place: PlaceName, conversationId: ConversationId): string =>
  place ?? `conversation:${conversationId}`

const requireChannelOf = (memberId: MemberId, place: PlaceName): T.Task<void, NotFound, AppEnv> =>
  T.gen(function* () {
    if (place === null) return
    const found = yield* first(sql`SELECT ch.slug FROM channels ch
      JOIN participants p ON p.conversation_id = ch.conversation_id AND p.member_id = ${memberId}
      WHERE ch.slug = ${place}`)
    if (found === null)
      return yield* T.fail(NotFound({ message: 'You can save a principle only for a channel you are in.' }))
  })

const changeToStore = (change: SuggestedChange | null): string | null =>
  change === null ? null : JSON.stringify({ added: change.added, removed: change.removed })

const suggestionOf = (row: Pick<OfferRow, 'suggested_change'>): SuggestedChange | null => {
  if (row.suggested_change === null) return null
  const { added, removed } = JSON.parse(row.suggested_change) as SuggestedChange
  return { added, removed }
}

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

/** A principle as the server keeps it, always with its counts; the person sees them only with agent figures on. */
type CountedPrinciple = Principle & { readonly counts: PrincipleCounts }

const shownWith = (principle: CountedPrinciple, figures: boolean): Principle =>
  figures ? principle : { ...principle, counts: null }

const withFigures = (principle: CountedPrinciple): T.Task<Principle, never, AppEnv> =>
  T.map((figures: boolean) => shownWith(principle, figures))(featureIsOn('agentFigures'))

const ownPrinciple = (memberId: MemberId, id: string): T.Task<CountedPrinciple, NotFound, AppEnv> =>
  T.gen(function* () {
    const found = (yield* principlesOf(memberId)).find((principle) => principle.id === id)
    if (found === undefined) return yield* T.fail(NotFound({ message: 'No such principle.' }))
    return found
  })

const principlesOf = (memberId: MemberId): T.Task<CountedPrinciple[], never, AppEnv> =>
  T.gen(function* () {
    const rows = yield* all<PrincipleRow>(
      sql`SELECT * FROM principles WHERE member_id = ${memberId} ORDER BY position, created_at, id`,
    )
    if (rows.length === 0) return []
    const applications = yield* all<ApplicationRow>(sql`
      SELECT a.principle_id, n.status, n.origin, n.decided_at, a.missed_at
      FROM principle_applications a JOIN notes n ON n.id = a.note_id AND n.debate_id IS NULL
      WHERE a.principle_id IN ${list(rows.map((row) => row.id))}`)
    const byPrinciple = Map.groupBy(applications, (application) => application.principle_id)
    return rows.map((row) => toPrinciple(row, byPrinciple.get(row.id) ?? []))
  })

const toPrinciple = (row: PrincipleRow, applications: ReadonlyArray<ApplicationRow>): CountedPrinciple => ({
  id: row.id,
  kind: row.kind,
  topic: row.topic,
  rule: row.rule,
  source: row.source,
  place: row.place,
  enabled: Number(row.enabled) === 1,
  origin: row.origin,
  position: Number(row.position),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
  lastAppliedAt: row.last_applied_at === null ? null : Number(row.last_applied_at),
  publicText: row.public_text,
  counts: {
    applied: applications.length,
    sentAsWritten: applications.filter((each) => each.status === 'sent' && each.origin === 'agent').length,
    edited: applications.filter((each) => each.status === 'sent' && each.origin !== 'agent').length,
    discarded: applications.filter((each) => each.status === 'discarded' && each.decided_at !== null).length,
    missed: applications.filter((each) => each.missed_at !== null).length,
  },
})

const openOffer = (memberId: MemberId, id: string): T.Task<OfferRow, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* first<OfferRow>(
      sql`SELECT * FROM principle_offers WHERE id = ${id} AND member_id = ${memberId} AND closed_at IS NULL`,
    )
    if (row === null) return yield* T.fail(NotFound({ message: 'That chance to teach is no longer open.' }))
    return row
  })

const openOffers = (memberId: MemberId): T.Task<PrincipleOffer[], never, AppEnv> =>
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

const routeMap = (
  memberId: MemberId,
  principles: ReadonlyArray<CountedPrinciple>,
  now: number,
): T.Task<RoutePoint[], never, AppEnv> =>
  T.gen(function* () {
    const drafts = yield* all<PlaceRow & { status: string; origin: string; decided_at: number | null }>(sql`
      SELECT n.status, n.origin, n.decided_at, ${PLACE_COLUMNS} FROM notes n ${PLACE_JOIN}
      WHERE n.author_id = ${memberId} AND n.agent_name IS NOT NULL AND n.debate_id IS NULL
      AND n.created_at > ${now - ROUTE_DAYS * DAY_MS}`)
    const byPlace = Map.groupBy(drafts, (draft) => placeOf(draft))
    const places = new Set<PlaceName>([...byPlace.keys(), ...principles.map((principle) => principle.place)])
    return [...places]
      .map((place) => {
        const taught = principles.filter((principle) => principle.place === place)
        const lastTaught = Math.max(0, ...taught.map((principle) => principle.createdAt))
        const here = byPlace.get(place) ?? []
        return {
          place,
          drafted: here.length,
          principles: taught.length,
          heldUp: taught.reduce((sum, principle) => sum + principle.counts.sentAsWritten, 0),
          chances: here.filter(
            (draft) =>
              draft.decided_at !== null &&
              Number(draft.decided_at) > lastTaught &&
              (draft.status === 'discarded' || draft.origin === 'human_edited'),
          ).length,
        }
      })
      .sort((a, b) => b.drafted - a.drafted || (a.place ?? '￿').localeCompare(b.place ?? '￿'))
  })
