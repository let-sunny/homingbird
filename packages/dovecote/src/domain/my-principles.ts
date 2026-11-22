import { Task as T } from '@homingbird/kernel'
import {
  type Achievement,
  type MemberId,
  type MyPrinciples,
  PRINCIPLES_PER_PERSON,
  type PlaceName,
  type RoutePoint,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { debateAchievementsOf, debateCreditsOf } from './debate-credits.ts'
import { agentReportFor } from './insights.ts'
import { PLACE_COLUMNS, PLACE_JOIN, type PlaceRow, placeOf } from './places.ts'
import { openOffers } from './principle-offers.ts'
import { type CountedPrinciple, principleShown, principlesOf, shownWith } from './principle-rows.ts'
import { featureIsOn } from './settings.ts'
import { DAY_MS } from './trust-figures.ts'

/** Everything the person taught their agent: principles, open chances to teach, the route map, achievements. */
export const myPrinciples = (memberId: MemberId): T.Task<MyPrinciples, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const principles = yield* principlesOf(memberId)
    const shown = yield* principleShown
    const figures = shown.figures
    const week = figures ? (yield* agentReportFor(memberId)).periods[0]!.current : null
    const debateCredits = (yield* featureIsOn('debateRooms')) ? yield* debateCreditsOf(memberId) : []
    return {
      principles: principles.map((principle) => shownWith(principle, shown)),
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
const ROUTE_DAYS = 30

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
