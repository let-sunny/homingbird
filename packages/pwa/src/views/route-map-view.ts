import type { MyPrinciples } from '@homingbird/protocol'
import { type Lifetime, h, region } from '@homingbird/ui'
import { type RouteNode, routeLayout } from '../route-map.ts'
import { taught } from '../state.ts'
import { formats, strings } from '../strings.ts'
import { placeName } from './agent-trust.ts'
import { teachButton } from './teaching.ts'

/** "Where it answers like me": the person in the middle, a point per place, lines grown by teaching. */
export const routeMapSection = (life: Lifetime): HTMLElement =>
  region(
    life,
    [taught],
    () => {
      const loaded = taught.get()
      if (loaded === null || loaded === 'failed') return null
      if (loaded.routes.length === 0) return emptyMap()
      const nodes = routeLayout(loaded.routes, MAP_SIZE)
      return [
        h('p', { class: 'trust-footnote' }, strings.routes.intro),
        h(
          'figure',
          { class: 'route-map' },
          mapDrawing(nodes),
          h('figcaption', { class: 'visually-hidden' }, strings.routes.intro),
        ),
        h('ul', { class: 'route-legend' }, nodes.map(legendItem)),
        mapTable(loaded),
      ]
    },
    { class: 'routes' },
  )

const MAP_SIZE = 320
const SVG = 'http://www.w3.org/2000/svg'

const svg = (
  tag: string,
  attributes: Readonly<Record<string, string | number>>,
  ...children: Element[]
): SVGElement => {
  const element = document.createElementNS(SVG, tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value))
  element.append(...children)
  return element
}

const mapDrawing = (nodes: ReadonlyArray<RouteNode>): SVGElement => {
  const centre = MAP_SIZE / 2
  return svg(
    'svg',
    {
      viewBox: `0 0 ${MAP_SIZE} ${MAP_SIZE}`,
      class: 'route-drawing',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ...nodes.map((node) =>
      svg('line', {
        x1: centre,
        y1: centre,
        x2: node.x,
        y2: node.y,
        class: `route-line${node.taught ? ' is-taught' : ''}`,
        'stroke-width': node.width,
      }),
    ),
    ...nodes.flatMap((node) =>
      Array.from({ length: node.chances }, (_, index) => {
        const share = 0.35 + index * 0.1
        const x = centre + (node.x - centre) * share
        const y = centre + (node.y - centre) * share
        return svg('rect', {
          x: x - 4,
          y: y - 4,
          width: 8,
          height: 8,
          transform: `rotate(45 ${x} ${y})`,
          class: 'route-chance',
        })
      }),
    ),
    svg('circle', { cx: centre, cy: centre, r: 14, class: 'route-you' }),
    ...nodes.map((node) =>
      svg('circle', { cx: node.x, cy: node.y, r: 9, class: `route-point${node.taught ? ' is-taught' : ''}` }),
    ),
    ...nodes.map((node) => {
      const label = svg('text', {
        x: node.x,
        y: node.y + (node.y < centre ? -16 : 24),
        class: 'route-label',
        'text-anchor': 'middle',
      })
      label.textContent = placeName(node.place)
      return label
    }),
    (() => {
      const you = svg('text', { x: centre, y: centre + 32, class: 'route-label', 'text-anchor': 'middle' })
      you.textContent = strings.routes.you
      return you
    })(),
  )
}

const legendItem = (node: RouteNode): HTMLElement =>
  h(
    'li',
    { class: 'route-item', data: { place: node.place ?? 'direct' } },
    h('strong', {}, placeName(node.place)),
    h('span', {}, strings.routes.principleCount({ count: node.point.principles })),
    h('span', {}, strings.routes.heldUpCount({ count: node.point.heldUp })),
    h('span', {}, strings.routes.draftedCount({ count: node.point.drafted })),
    node.point.chances > 0 &&
      h('span', { class: 'route-item-chances' }, strings.routes.chances({ count: node.point.chances })),
  )

const mapTable = (loaded: MyPrinciples): HTMLElement =>
  h(
    'details',
    { class: 'trend-table route-table' },
    h('summary', {}, strings.routes.table),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'trust-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            [
              strings.routes.placeColumn,
              strings.routes.draftedColumn,
              strings.routes.principlesColumn,
              strings.routes.heldUpColumn,
              strings.routes.chancesColumn,
            ].map((heading) => h('th', { scope: 'col' }, heading)),
          ),
        ),
        h(
          'tbody',
          {},
          loaded.routes.map((point) =>
            h(
              'tr',
              {},
              h('th', { scope: 'row' }, placeName(point.place)),
              ...[point.drafted, point.principles, point.heldUp, point.chances].map((value) =>
                h('td', {}, formats.decimal.format(value)),
              ),
            ),
          ),
        ),
      ),
    ),
  )

const emptyMap = (): HTMLElement =>
  h(
    'div',
    { class: 'teach-empty' },
    h('strong', {}, strings.teach.empty),
    h('p', {}, strings.teach.emptyHint),
    teachButton(),
  )
