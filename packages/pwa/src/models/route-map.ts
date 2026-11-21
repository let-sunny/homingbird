import { type AsRead, isKnown } from '@homingbird/protocol'
import { type RouteNode, routeLayout } from '../route-map.ts'
import { hrefFor } from '../routes.ts'
import { formats, strings } from '../strings.ts'
import { placeName } from './places.ts'

/** "Where it answers like me": a point per place around the person, with a legend and a table. */
export const routeMapModel = (taught: AsRead.MyPrinciples | 'failed' | null): RouteMapModel | null => {
  if (taught === null || taught === 'failed') return null
  const debate = debateCredits(taught)
  if (taught.routes.length === 0)
    return { kind: 'empty', title: strings.teach.empty, hint: strings.teach.emptyHint, debate }
  const nodes = routeLayout(taught.routes, MAP_SIZE)
  return {
    kind: 'map',
    intro: strings.routes.intro,
    size: MAP_SIZE,
    you: strings.routes.you,
    nodes: nodes.map((node) => ({ ...node, label: placeName(node.place) })),
    legend: nodes.map((node) => ({
      key: node.place ?? 'direct',
      name: placeName(node.place),
      counts: [
        strings.routes.principleCount({ count: node.point.principles }),
        strings.routes.heldUpCount({ count: node.point.heldUp }),
        strings.routes.draftedCount({ count: node.point.drafted }),
      ],
      chances:
        node.point.chances > 0
          ? {
              text: strings.routes.chances({ count: node.point.chances }),
              href: hrefFor({ name: 'agent', section: 'teaching' }),
            }
          : null,
    })),
    table: {
      summary: strings.routes.table,
      headings: [
        strings.routes.placeColumn,
        strings.routes.draftedColumn,
        strings.routes.principlesColumn,
        strings.routes.heldUpColumn,
        strings.routes.chancesColumn,
      ],
      rows: taught.routes.map((point) => [
        placeName(point.place),
        ...[point.drafted, point.principles, point.heldUp, point.chances].map((value) =>
          formats.decimal.format(value),
        ),
      ]),
    },
    debate,
  }
}

export type RouteMapModel =
  | {
      readonly kind: 'empty'
      readonly title: string
      readonly hint: string
      readonly debate: DebateCredits | null
    }
  | {
      readonly kind: 'map'
      readonly intro: string
      readonly size: number
      readonly you: string
      readonly nodes: ReadonlyArray<RouteNode & { readonly label: string }>
      readonly legend: ReadonlyArray<{
        readonly key: string
        readonly name: string
        readonly counts: ReadonlyArray<string>
        /** The chances to teach there, as a way to the list of them under Teaching. */
        readonly chances: { readonly text: string; readonly href: string } | null
      }>
      readonly table: {
        readonly summary: string
        readonly headings: ReadonlyArray<string>
        readonly rows: ReadonlyArray<ReadonlyArray<string>>
      }
      readonly debate: DebateCredits | null
    }

export interface DebateCredits {
  readonly title: string
  readonly intro: string
  readonly credits: ReadonlyArray<string>
}

const MAP_SIZE = 320

/** What approved debate results credited the agent for, each kind once: never a count or a ranking. */
const debateCredits = (taught: AsRead.MyPrinciples): DebateCredits | null => {
  const known = (taught.debateCredits ?? []).filter(isKnown)
  return known.length === 0
    ? null
    : {
        title: strings.routes.debateRooms,
        intro: strings.routes.debateIntro,
        credits: known.map((credit) => strings.teach.achievements[`debate_${credit}`]),
      }
}
