import type { OrganizationInsights } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import type { AuthorshipModel, DeliveryModel } from '../models/insights-sections.ts'
import {
  type InsightsModel,
  type InsightsPlaces,
  type InsightsTable,
  insightsModel,
} from '../models/insights.ts'
import { strings } from '../strings.ts'
import { periodChoice, renderLabelsTable, renderTrend, shareBar } from './agent-figures.ts'
import type { ViewContext } from './context.ts'
import { loading } from './parts.ts'

/** Organization-wide numbers for administrators, over the period they choose. */
export const insightsSection = (context: ViewContext, life: Lifetime): HTMLElement => {
  const loaded = signal<OrganizationInsights | null>(null)
  const days = signal(30)
  context.actions.loadInsights({ done: (insights) => loaded.set(insights) })
  return h(
    'div',
    { class: 'insights' },
    h('p', {}, strings.insights.intro),
    periodChoice('insights-period', days),
    region(life, [loaded, days], () => renderInsights(insightsModel(loaded.get(), days.get()))),
  )
}

const renderInsights = (model: InsightsModel): Child => {
  if (model.kind === 'loading') return loading()
  return [
    model.warnings.length > 0 &&
      h(
        'div',
        { class: 'flow-warning', role: 'note' },
        model.warnings.map((warning) => h('p', {}, warning)),
      ),
    model.quickWarning !== null &&
      h('p', { class: 'flow-warning insights-quick-warning', role: 'status' }, model.quickWarning),
    model.tooFew !== null && h('p', { class: 'insights-too-few' }, model.tooFew),
    model.figures !== null && [
      table(model.figures.table),
      authorship(model.figures.authorship),
      delivery(model.figures.delivery),
      places(model.figures.places),
      model.figures.teams !== null && places(model.figures.teams, 'insights-teams'),
      renderLabelsTable(model.figures.byClient),
      renderLabelsTable(model.figures.byModel),
      model.figures.hiddenLabels !== null && h('p', { class: 'trust-footnote' }, model.figures.hiddenLabels),
    ],
    model.quickTrend !== null && renderTrend(model.quickTrend),
    h('p', { class: 'insights-blocks' }, model.blocks),
    h('p', {}, h('a', { href: model.measured.href }, model.measured.label)),
  ]
}

const authorship = (model: AuthorshipModel): HTMLElement =>
  h(
    'section',
    { class: 'trust-section', 'aria-labelledby': 'insights-authorship' },
    h('h2', { id: 'insights-authorship' }, model.title),
    model.hidden !== null
      ? h('p', { class: 'trust-footnote' }, model.hidden)
      : h(
          'ul',
          { class: 'trust-places' },
          model.rows.map((row) =>
            h(
              'li',
              { class: 'trust-place', data: { authorship: row.key } },
              h('span', { class: 'trust-place-line' }, row.line),
              shareBar(row.share),
            ),
          ),
        ),
  )

const delivery = (model: DeliveryModel): HTMLElement =>
  h(
    'section',
    { class: 'trust-section', 'aria-labelledby': 'insights-delivery' },
    h('h2', { id: 'insights-delivery' }, model.title),
    h('p', { class: 'trust-footnote' }, model.intro),
    model.hidden !== null
      ? h('p', { class: 'trust-footnote' }, model.hidden)
      : h(
          'div',
          { class: 'table-scroll' },
          h(
            'table',
            { class: 'trust-table' },
            h(
              'tbody',
              {},
              model.rows.map(([label, value]) =>
                h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, value)),
              ),
            ),
          ),
        ),
  )

const table = (model: InsightsTable): HTMLElement =>
  h(
    'div',
    { class: 'table-scroll trust-table-scroll' },
    h(
      'table',
      { class: 'trust-table' },
      h('caption', {}, model.caption),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          model.headings.map((heading) => h('th', { scope: 'col' }, heading)),
        ),
      ),
      h(
        'tbody',
        {},
        model.rows.map(([label, current, previous]) =>
          h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, current), h('td', {}, previous)),
        ),
      ),
    ),
    model.footnotes.map((footnote) => h('p', { class: 'trust-footnote' }, footnote)),
  )

const places = (model: InsightsPlaces, id = 'insights-places'): HTMLElement =>
  h(
    'section',
    { class: 'trust-section', 'aria-labelledby': id },
    h('h2', { id }, model.title),
    model.none !== null
      ? h('p', {}, model.none)
      : h(
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
                model.headings.map((heading) => h('th', { scope: 'col' }, heading)),
              ),
            ),
            h(
              'tbody',
              {},
              model.rows.map(([place, ...cells]) =>
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
    model.hidden !== null && h('p', { class: 'trust-footnote' }, model.hidden),
    model.footnote !== undefined && h('p', { class: 'trust-footnote' }, model.footnote),
  )
