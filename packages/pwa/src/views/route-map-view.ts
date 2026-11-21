import { type Child, type Lifetime, h, region, svg } from '@homingbird/ui'
import { type DebateCredits, type RouteMapModel, routeMapModel } from '../models/route-map.ts'
import type { ViewContext } from './context.ts'
import { teachButton } from './teaching.ts'

/** "Where it answers like me": the person in the middle, a point per place, lines grown by teaching. */
export const routeMapSection = (context: ViewContext, life: Lifetime): HTMLElement => {
  context.actions.refreshPrinciples()
  return region(
    life,
    [context.state.taught],
    () => renderRouteMap(routeMapModel(context.state.taught.get()), context),
    { class: 'routes' },
  )
}

const renderRouteMap = (model: RouteMapModel | null, context: ViewContext): Child => {
  if (model === null) return null
  if (model.kind === 'empty')
    return [
      h(
        'div',
        { class: 'teach-empty' },
        h('strong', {}, model.title),
        h('p', {}, model.hint),
        teachButton(context),
      ),
      debateRoute(model.debate),
    ]
  return [
    h('p', { class: 'trust-footnote' }, model.intro),
    h(
      'figure',
      { class: 'route-map' },
      mapDrawing(model),
      h('figcaption', { class: 'visually-hidden' }, model.intro),
    ),
    h(
      'ul',
      { class: 'route-legend' },
      model.legend.map((item) =>
        h(
          'li',
          { class: 'route-item', data: { place: item.key } },
          h('strong', {}, item.name),
          item.counts.map((count) => h('span', {}, count)),
          item.chances !== null && h('span', { class: 'route-item-chances' }, item.chances),
        ),
      ),
    ),
    h(
      'details',
      { class: 'trend-table route-table' },
      h('summary', {}, model.table.summary),
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
              model.table.headings.map((heading) => h('th', { scope: 'col' }, heading)),
            ),
          ),
          h(
            'tbody',
            {},
            model.table.rows.map(([place, ...cells]) =>
              h(
                'tr',
                {},
                h('th', { scope: 'row' }, place),
                cells.map((cell) => h('td', {}, cell)),
              ),
            ),
          ),
        ),
      ),
    ),
    debateRoute(model.debate),
  ]
}

const text = (attributes: Readonly<Record<string, string | number>>, content: string): SVGElement => {
  const label = svg('text', attributes)
  label.textContent = content
  return label
}

const mapDrawing = (model: Extract<RouteMapModel, { kind: 'map' }>): SVGElement => {
  const centre = model.size / 2
  const nodes = model.nodes
  return svg(
    'svg',
    {
      viewBox: `0 0 ${model.size} ${model.size}`,
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
    ...nodes.map((node) =>
      text(
        {
          x: node.x,
          y: node.y + (node.y < centre ? -16 : 24),
          class: 'route-label',
          'text-anchor': 'middle',
        },
        node.label,
      ),
    ),
    text({ x: centre, y: centre + 32, class: 'route-label', 'text-anchor': 'middle' }, model.you),
  )
}

const debateRoute = (credits: DebateCredits | null): HTMLElement | null =>
  credits === null
    ? null
    : h(
        'section',
        { class: 'route-debates', 'aria-labelledby': 'route-debates' },
        h('h3', { id: 'route-debates' }, credits.title),
        h('p', { class: 'trust-footnote' }, credits.intro),
        h(
          'ul',
          {},
          credits.credits.map((credit) => h('li', { class: 'route-debate-credit' }, credit)),
        ),
      )
