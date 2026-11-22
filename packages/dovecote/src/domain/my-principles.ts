import { Task as T } from '@homingbird/kernel'
import {
  type Achievement,
  type MemberId,
  type MyPrinciples,
  PRINCIPLES_PER_PERSON,
  type PlaceName,
  type PrincipleOffer,
  type RoutePoint,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all } from '../sql/database.ts'
import { list, sql } from '../sql/query.ts'
import { debateAchievementsOf, debateCreditsOf } from './debate-credits.ts'
import { agentReportFor } from './insights.ts'
import { PLACE_COLUMNS, PLACE_JOIN, type PlaceRow, placeOf } from './places.ts'
import { openOffers } from './principle-offers.ts'
import { type CountedPrinciple, principlesOf, shownWith } from './principle-rows.ts'
import { featureIsOn } from './settings.ts'
import { DAY_MS } from './trust-figures.ts'

/** Everything the person taught their agent: principles, open chances to teach, each place's progress, achievements. */
export const myPrinciples = (memberId: MemberId): T.Task<MyPrinciples, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const principles = yield* principlesOf(memberId)
    const figures = yield* featureIsOn('agentFigures')
    const week = figures ? (yield* agentReportFor(memberId)).periods[0]!.current : null
    const debateCredits = (yield* featureIsOn('debateRooms')) ? yield* debateCreditsOf(memberId) : []
    const offers = yield* openOffers(memberId)
    return {
      principles: principles.map((principle) => shownWith(principle, figures)),
      offers,
      routes: yield* placesTaught(memberId, principles, offers, env.clock.now()),
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

const CAREFUL_WEEK_DECISIONS = 5
const DRAFTED_DAYS = 30

/**
 * Each place the agent drafted in over the last 30 days, or that a principle or a chance to teach names:
 * the principles that apply there, the drafts there that applied one and were sent as written, and the
 * open chances to teach from there, the same ones Teaching lists.
 */
const placesTaught = (
  memberId: MemberId,
  principles: ReadonlyArray<CountedPrinciple>,
  offers: ReadonlyArray<PrincipleOffer>,
  now: number,
): T.Task<RoutePoint[], never, AppEnv> =>
  T.gen(function* () {
    const drafts = yield* all<PlaceRow>(sql`
      SELECT ${PLACE_COLUMNS} FROM notes n ${PLACE_JOIN}
      WHERE n.author_id = ${memberId} AND n.agent_name IS NOT NULL AND n.debate_id IS NULL
      AND n.created_at > ${now - DRAFTED_DAYS * DAY_MS}`)
    const heldUp =
      principles.length === 0
        ? []
        : yield* all<PlaceRow & { note_id: string; principle_id: string }>(sql`
          SELECT DISTINCT a.note_id, a.principle_id, ${PLACE_COLUMNS}
          FROM principle_applications a JOIN notes n ON n.id = a.note_id ${PLACE_JOIN}
          WHERE a.principle_id IN ${list(principles.map((principle) => principle.id))}
          AND n.debate_id IS NULL AND n.status = 'sent' AND n.origin = 'agent'`)
    const draftedIn = Map.groupBy(drafts, (draft) => placeOf(draft))
    const places = new Set<PlaceName>([
      ...draftedIn.keys(),
      ...principles.flatMap((principle) => (principle.place === null ? [] : [principle.place])),
      ...offers.map((offer) => offer.place),
    ])
    return [...places]
      .map((place) => {
        const here = principles.filter((principle) => appliesIn(principle, place))
        const ids = new Set<string>(here.map((principle) => principle.id))
        return {
          place,
          drafted: draftedIn.get(place)?.length ?? 0,
          principles: here.length,
          heldUp: new Set(
            heldUp
              .filter((row) => ids.has(row.principle_id) && placeOf(row) === place)
              .map((row) => row.note_id),
          ).size,
          chances: offers.filter((offer) => offer.place === place).length,
        }
      })
      .sort((a, b) => b.drafted - a.drafted || (a.place ?? '\uffff').localeCompare(b.place ?? '\uffff'))
  })

/** Whether a principle applies in a place: a principle for any channel applies everywhere, direct messages included. */
const appliesIn = (principle: { readonly place: PlaceName }, place: PlaceName): boolean =>
  principle.place === null || principle.place === place
