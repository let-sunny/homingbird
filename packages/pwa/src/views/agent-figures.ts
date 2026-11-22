import { type Child, type Signal, h } from '@homingbird/ui'
import { type FiguresModel, type LabelsTable, type Trend, periodChoices } from '../models/agent-figures.ts'
import { strings } from '../strings.ts'
import { loading } from './parts.ts'
import { sessionSection } from './session-health-view.ts'

/**
 * How the agent is doing: the verdict, the numbers table with what lies behind its counts, skips,
 * labels, trend and sessions.
 */
export const renderFigures = (model: FiguresModel, behind: Child = null): Child => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'failed') return h('p', { role: 'alert' }, model.text)
  const { headline, table } = model
  return [
    h(
      'section',
      { class: `trust-headline ${headline.verdictClass}`, 'aria-labelledby': 'trust-verdict' },
      h('h3', { id: 'trust-verdict' }, headline.verdict),
      h('p', { class: 'trust-basis' }, headline.basis),
      headline.change !== null && h('p', { class: 'trust-change' }, headline.change),
      h('p', { class: 'trust-teach' }, headline.teach),
      headline.nudge !== null &&
        h(
          'div',
          { class: 'trust-nudge', role: 'note' },
          h('strong', {}, headline.nudge.title),
          h('p', {}, headline.nudge.detail),
        ),
    ),
    h(
      'div',
      { class: 'table-scroll trust-table-scroll' },
      h(
        'table',
        { class: 'trust-table' },
        h('caption', {}, table.caption),
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            table.headings.map((heading) => h('th', { scope: 'col' }, heading)),
          ),
        ),
        h(
          'tbody',
          {},
          table.rows.map(([label, current, previous]) =>
            h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, current), h('td', {}, previous)),
          ),
        ),
      ),
      table.footnotes.map((footnote) => h('p', { class: 'trust-footnote' }, footnote)),
    ),
    behind,
    model.skips !== null &&
      h(
        'section',
        { class: 'trust-section', 'aria-labelledby': 'trust-skips' },
        h('h3', { id: 'trust-skips' }, model.skips.title),
        model.skips.none !== null
          ? h('p', {}, model.skips.none)
          : h(
              'ul',
              { class: 'trust-reasons' },
              model.skips.reasons.map((reason) => h('li', {}, reason)),
            ),
      ),
    renderLabelsTable(model.byClient),
    renderLabelsTable(model.byModel),
    renderTrend(model.trend),
    sessionSection(model.report),
    h(
      'details',
      { class: 'trust-measured' },
      h('summary', {}, model.measured.title),
      h(
        'ul',
        {},
        model.measured.lines.map((line) => h('li', {}, line)),
      ),
      h('p', {}, model.measured.privacy),
      h('p', {}, h('a', { href: model.measured.link.href }, model.measured.link.label)),
    ),
  ]
}

/** A choice between the periods, kept outside what it redraws so the focus stays on the chosen one. */
export const periodChoice = (name: string, chosen: Signal<number>): HTMLElement =>
  h(
    'fieldset',
    { class: 'trust-period' },
    h('legend', {}, strings.trust.period),
    periodChoices(chosen.get()).map((choice) =>
      h(
        'label',
        { class: 'choice' },
        h('input', {
          type: 'radio',
          name,
          value: String(choice.days),
          checked: choice.checked,
          on: { change: () => chosen.set(choice.days) },
        }),
        choice.label,
      ),
    ),
  )

export const renderLabelsTable = (table: LabelsTable | null): HTMLElement | null =>
  table === null
    ? null
    : h(
        'section',
        { class: 'trust-section', 'aria-labelledby': table.id },
        h('h3', { id: table.id }, table.title),
        h(
          'div',
          { class: 'table-scroll' },
          h(
            'table',
            { class: 'trust-table labels-table' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                table.headings.map((heading) => h('th', { scope: 'col' }, heading)),
              ),
            ),
            h(
              'tbody',
              {},
              table.rows.map((row) =>
                h(
                  'tr',
                  {},
                  h(
                    'th',
                    { scope: 'row', title: row.title },
                    row.label,
                    row.models !== null && h('span', { class: 'label-models' }, row.models),
                  ),
                  row.cells.map((cell) => h('td', {}, cell)),
                ),
              ),
            ),
          ),
        ),
      )

/** A bar filled to a share, for the eye only: the share is always written beside it. */
export const shareBar = (share: number | null): HTMLElement => {
  const bar = h(
    'span',
    { class: `share-bar${share === null ? ' is-empty' : ''}`, 'aria-hidden': 'true' },
    h('span', { class: 'share-bar-fill' }),
  )
  bar.style.setProperty('--share', String(share ?? 0))
  return bar
}

/** Shares week by week as bars, with the same weeks as a table for anyone who wants the numbers. */
export const renderTrend = (trend: Trend): HTMLElement =>
  h(
    'section',
    { class: 'trust-section', 'aria-labelledby': trend.id },
    h('h3', { id: trend.id }, trend.title),
    h('p', { class: 'trust-footnote' }, trend.intro),
    h(
      'ol',
      { class: 'trend' },
      trend.bars.map((bar) => {
        const column = h(
          'li',
          { class: `trend-week${bar.share === null ? ' is-empty' : ''}` },
          h('span', { class: 'trend-share', 'aria-hidden': 'true' }, bar.shareText),
          h('span', { class: 'trend-bar', 'aria-hidden': 'true' }, h('span', { class: 'trend-fill' })),
          h('span', { class: 'trend-label', 'aria-hidden': 'true' }, bar.label),
          h('span', { class: 'visually-hidden' }, bar.spoken),
        )
        column.style.setProperty('--share', String(bar.share ?? 0))
        return column
      }),
    ),
    h(
      'details',
      { class: 'trend-table' },
      h('summary', {}, trend.tableSummary),
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
              trend.headings.map((heading) => h('th', { scope: 'col' }, heading)),
            ),
          ),
          h(
            'tbody',
            {},
            trend.rows.map(([week, ...cells]) =>
              h(
                'tr',
                {},
                h('th', { scope: 'row' }, week),
                cells.map((cell) => h('td', {}, cell)),
              ),
            ),
          ),
        ),
      ),
    ),
  )
