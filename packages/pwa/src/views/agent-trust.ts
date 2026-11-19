import type {
  AgentFigures,
  AgentPeriod,
  AgentReport,
  LabelTotals,
  Me,
  OrganizationLabelTotals,
  PlaceName,
  PlaceTrust,
} from '@homingbird/protocol'
import { type Child, type Lifetime, type Signal, h, region, signal } from '@homingbird/ui'
import { launch, refreshAgentReport } from '../actions.ts'
import { shortLabel } from '../authorship.ts'
import { channelLabel } from '../channels.ts'
import { featureOn } from '../features.ts'
import { AGENT_SECTIONS, type AgentSection, hrefFor } from '../routes.ts'
import { agentReport } from '../state.ts'
import { durationOf, formats, percentOf, strings } from '../strings.ts'
import { PERIODS, compareSentAsWritten, decidedOf, periodOf, shareOf, trendBars } from '../trust.ts'
import { connectionSection } from './connection.ts'
import { loading, page } from './parts.ts'
import { routeMapSection } from './route-map-view.ts'
import { sessionSection } from './session-health-view.ts'
import { taughtSection } from './teaching.ts'

/**
 * "My agent": one page in four headed sections, connection, teaching, how it is doing and the route
 * map, each reachable by its own address.
 */
export const agentTrustView = (life: Lifetime, me: Me, section: AgentSection | null): HTMLElement => {
  if (featureOn('agentFigures')) launch(refreshAgentReport)
  const days = signal(7)
  const view = page(
    strings.trust.pageTitle,
    h(
      'nav',
      { class: 'my-agent-nav', 'aria-label': strings.trust.onThisPage },
      h(
        'ol',
        {},
        sectionsOn().map((each) =>
          h(
            'li',
            {},
            h(
              'a',
              {
                href: hrefFor({ name: 'agent', section: each }),
                'aria-current': each === section && 'location',
              },
              strings.trust.sections[each],
            ),
          ),
        ),
      ),
    ),
    agentSection('connection', connectionSection(life, me)),
    featureOn('teaching') && agentSection('teaching', taughtSection(life)),
    featureOn('agentFigures') &&
      agentSection(
        'doing',
        h('p', { class: 'trust-intro' }, strings.trust.intro),
        periodChoice('trust-period', days),
        doingNow(life, days),
      ),
    featureOn('teaching') && featureOn('routeMap') && agentSection('routes', routeMapSection(life)),
  )
  if (section !== null)
    requestAnimationFrame(() => {
      const heading = document.getElementById(`agent-${section}`)
      heading?.scrollIntoView({ block: 'start' })
      heading?.focus({ preventScroll: true })
    })
  return view
}

/** The sections of My agent whose features are on; Connection is always there. */
const sectionsOn = (): AgentSection[] =>
  AGENT_SECTIONS.filter(
    (section) =>
      section === 'connection' ||
      (section === 'teaching' && featureOn('teaching')) ||
      (section === 'doing' && featureOn('agentFigures')) ||
      (section === 'routes' && featureOn('teaching') && featureOn('routeMap')),
  )

const agentSection = (section: AgentSection, ...content: ReadonlyArray<Child>): HTMLElement =>
  h(
    'section',
    { class: `my-agent-section is-${section}`, 'aria-labelledby': `agent-${section}` },
    h('h2', { id: `agent-${section}`, tabindex: '-1' }, strings.trust.sections[section]),
    ...content,
  )

const doingNow = (life: Lifetime, days: Signal<number>): HTMLElement =>
  region(
    life,
    [agentReport, days],
    () => {
      const report = agentReport.get()
      if (report === null) return loading()
      if (report === 'failed') return h('p', { role: 'alert' }, strings.trust.loadFailed)
      const period = periodOf(report, days.get())
      return [
        headline(report, period),
        numbersTable(report, period),
        skipReasons(period.current),
        placesSection(period.current),
        labelsTable(
          'trust-by-client',
          strings.trust.byClientTitle,
          period.current.byClient,
          strings.trust.clientUnknown,
        ),
        labelsTable(
          'trust-by-model',
          strings.trust.byModelTitle,
          period.current.byModel,
          strings.trust.modelNotStated,
        ),
        trendSection(report),
        sessionSection(report),
        measuredDisclosure(report),
      ]
    },
    { class: 'trust-page' },
  )

/** A choice between the periods, kept outside what it redraws so the focus stays on the chosen one. */
export const periodChoice = (name: string, chosen: Signal<number>): HTMLElement =>
  h(
    'fieldset',
    { class: 'trust-period' },
    h('legend', {}, strings.trust.period),
    PERIODS.map((days) =>
      h(
        'label',
        { class: 'choice' },
        h('input', {
          type: 'radio',
          name,
          value: String(days),
          checked: days === chosen.get(),
          on: { change: () => chosen.set(days) },
        }),
        strings.trust.lastDays({ days }),
      ),
    ),
  )

export const verdictText = (figures: AgentFigures): string => strings.trust.verdict[figures.verdict]

export const placeName = (place: PlaceName): string =>
  place === null ? strings.trust.directMessages : channelLabel(place)

const basisText = (report: AgentReport, period: AgentPeriod): string => {
  const figures = period.current
  const decided = decidedOf(figures)
  return figures.verdict === 'too_few'
    ? strings.trust.tooFewBasis({ count: decided, days: period.days, minimum: report.minimumDecided })
    : strings.trust.basis({ count: decided, asWritten: figures.sentAsWritten, days: period.days })
}

const headline = (report: AgentReport, period: AgentPeriod): HTMLElement => {
  const figures = period.current
  const comparison = compareSentAsWritten(period)
  return h(
    'section',
    {
      class: `trust-headline is-${figures.verdict.replaceAll('_', '-')}`,
      'aria-labelledby': 'trust-verdict',
    },
    h('h3', { id: 'trust-verdict' }, verdictText(figures)),
    h('p', { class: 'trust-basis' }, basisText(report, period)),
    comparison.share !== null && h('p', { class: 'trust-change' }, comparisonText(comparison)),
    h('p', { class: 'trust-teach' }, strings.trust.teach[figures.verdict]),
    figures.quickApprovalsFrequent &&
      h(
        'div',
        { class: 'trust-nudge', role: 'note' },
        h('strong', {}, strings.trust.nudge),
        h(
          'p',
          {},
          strings.trust.nudgeDetail({ count: figures.quickApprovals, seconds: report.quickApprovalSeconds }),
        ),
      ),
  )
}

const comparisonText = (comparison: ReturnType<typeof compareSentAsWritten>): string => {
  const share = percentOf(comparison.share ?? 0)
  const before = comparison.before === null ? '' : percentOf(comparison.before)
  switch (comparison.change) {
    case 'up':
      return strings.trust.shareUp({ share, before })
    case 'down':
      return strings.trust.shareDown({ share, before })
    case 'same':
      return strings.trust.shareSame({ share })
    case 'new':
      return strings.trust.shareNew({ share })
  }
}

const numbersTable = (report: AgentReport, period: AgentPeriod): HTMLElement => {
  const rows = strings.trust.rows
  const line = (label: string, value: (figures: AgentFigures) => string): HTMLElement =>
    h(
      'tr',
      {},
      h('th', { scope: 'row' }, label),
      h('td', {}, value(period.current)),
      h('td', {}, value(period.previous)),
    )
  const counted = (pick: (figures: AgentFigures) => number) => (figures: AgentFigures) =>
    formats.decimal.format(pick(figures))
  const withShare = (pick: (figures: AgentFigures) => number) => (figures: AgentFigures) => {
    const share = shareOf(pick(figures), decidedOf(figures))
    const count = formats.decimal.format(pick(figures))
    return share === null ? count : strings.trust.countAndShare({ count, share: percentOf(share) })
  }
  return h(
    'div',
    { class: 'table-scroll trust-table-scroll' },
    h(
      'table',
      { class: 'trust-table' },
      h('caption', {}, strings.trust.caption({ days: period.days })),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, strings.trust.what),
          h('th', { scope: 'col' }, strings.trust.lastDays({ days: period.days })),
          h('th', { scope: 'col' }, strings.trust.before({ days: period.days })),
        ),
      ),
      h(
        'tbody',
        {},
        line(
          rows.written,
          counted((figures) => figures.written),
        ),
        line(
          rows.sentAsWritten,
          withShare((figures) => figures.sentAsWritten),
        ),
        line(
          rows.sentAfterEdits,
          withShare((figures) => figures.sentAfterEdits),
        ),
        line(
          rows.discarded,
          withShare((figures) => figures.discarded),
        ),
        line(
          rows.skipped,
          counted((figures) => figures.skipped),
        ),
        line(
          rows.expiredRequests,
          counted((figures) => figures.expiredRequests),
        ),
        line(rows.medianDecision, (figures) =>
          figures.medianDecisionMs === null ? strings.trust.noneYet : durationOf(figures.medianDecisionMs),
        ),
        line(
          rows.quickApprovals,
          counted((figures) => figures.quickApprovals),
        ),
        line(
          rows.wroteYourself,
          counted((figures) => figures.wroteYourself),
        ),
      ),
    ),
    h(
      'p',
      { class: 'trust-footnote' },
      strings.trust.quickExplained({ seconds: report.quickApprovalSeconds }),
    ),
  )
}

const skipReasons = (figures: AgentFigures): Child =>
  figures.skipped > 0 &&
  h(
    'section',
    { class: 'trust-section', 'aria-labelledby': 'trust-skips' },
    h('h3', { id: 'trust-skips' }, strings.trust.skipsTitle),
    figures.skipReasons.length === 0
      ? h('p', {}, strings.trust.noSkipReasons)
      : h(
          'ul',
          { class: 'trust-reasons' },
          figures.skipReasons.map((entry) =>
            h('li', {}, strings.trust.skipReason({ reason: entry.reason, count: entry.count })),
          ),
        ),
  )

/** Drafts by the program that wrote them, or by the model the agent stated, as a table. */
export const labelsTable = (
  id: string,
  title: string,
  rows: ReadonlyArray<LabelTotals | OrganizationLabelTotals>,
  unknown: string,
): Child =>
  rows.length > 0 &&
  h(
    'section',
    { class: 'trust-section', 'aria-labelledby': id },
    h('h3', { id }, title),
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
            [
              strings.trust.labelColumn,
              strings.trust.rows.written,
              strings.trust.rows.sentAsWritten,
              strings.trust.rows.sentAfterEdits,
              strings.trust.rows.discarded,
            ].map((heading) => h('th', { scope: 'col' }, heading)),
          ),
        ),
        h(
          'tbody',
          {},
          rows.map((row) =>
            h(
              'tr',
              {},
              h(
                'th',
                { scope: 'row', title: row.label ?? unknown },
                row.label === null ? unknown : shortLabel(row.label),
              ),
              ...[row.written, row.sentAsWritten, row.sentAfterEdits, row.discarded].map((value) =>
                h('td', {}, value === null ? strings.insights.hidden : formats.decimal.format(value)),
              ),
            ),
          ),
        ),
      ),
    ),
  )

const placesSection = (figures: AgentFigures): Child =>
  figures.places.length > 0 &&
  h(
    'section',
    { class: 'trust-section', 'aria-labelledby': 'trust-places' },
    h('h3', { id: 'trust-places' }, strings.trust.placesTitle),
    h('p', { class: 'trust-footnote' }, strings.trust.placesIntro),
    h('ul', { class: 'trust-places' }, figures.places.map(placeRow)),
  )

const placeRow = (place: PlaceTrust): HTMLElement => {
  const decided = decidedOf(place)
  const share = shareOf(place.sentAsWritten, decided)
  const name = placeName(place.place)
  return h(
    'li',
    { class: 'trust-place', data: { place: place.place ?? 'direct' } },
    h(
      'span',
      { class: 'trust-place-line' },
      decided === 0
        ? strings.trust.placeNothingDecided({ place: name })
        : strings.trust.placeLine({ place: name, asWritten: place.sentAsWritten, decided }),
    ),
    shareBar(share),
    decided > 0 && h('span', { class: 'trust-place-verdict' }, strings.trust.verdict[place.verdict]),
    place.skipped > 0 &&
      h('span', { class: 'trust-place-skipped' }, strings.trust.placeSkipped({ count: place.skipped })),
  )
}

const shareBar = (share: number | null): HTMLElement => {
  const bar = h(
    'span',
    { class: `share-bar${share === null ? ' is-empty' : ''}`, 'aria-hidden': 'true' },
    h('span', { class: 'share-bar-fill' }),
  )
  bar.style.setProperty('--share', String(share ?? 0))
  return bar
}

const trendSection = (report: AgentReport): HTMLElement => {
  const bars = trendBars(report.weeks)
  const weekLabel = (start: number): string => formats.day.format(new Date(start))
  return h(
    'section',
    { class: 'trust-section', 'aria-labelledby': 'trust-trend' },
    h('h3', { id: 'trust-trend' }, strings.trust.trendTitle),
    h('p', { class: 'trust-footnote' }, strings.trust.trendIntro),
    h(
      'ol',
      { class: 'trend' },
      bars.map((bar) => {
        const column = h(
          'li',
          { class: `trend-week${bar.share === null ? ' is-empty' : ''}` },
          h(
            'span',
            { class: 'trend-share', 'aria-hidden': 'true' },
            bar.share === null ? '–' : percentOf(bar.share),
          ),
          h('span', { class: 'trend-bar', 'aria-hidden': 'true' }, h('span', { class: 'trend-fill' })),
          h('span', { class: 'trend-label', 'aria-hidden': 'true' }, weekLabel(bar.start)),
          h(
            'span',
            { class: 'visually-hidden' },
            bar.decided === 0
              ? strings.trust.trendEmptyWeek({ date: weekLabel(bar.start) })
              : strings.trust.trendWeek({
                  date: weekLabel(bar.start),
                  asWritten: bar.sentAsWritten,
                  decided: bar.decided,
                }),
          ),
        )
        column.style.setProperty('--share', String(bar.share ?? 0))
        return column
      }),
    ),
    h(
      'details',
      { class: 'trend-table' },
      h('summary', {}, strings.trust.trendTable),
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
              h('th', { scope: 'col' }, strings.trust.weekColumn),
              h('th', { scope: 'col' }, strings.trust.decidedColumn),
              h('th', { scope: 'col' }, strings.trust.rows.sentAsWritten),
              h('th', { scope: 'col' }, strings.trust.shareColumn),
            ),
          ),
          h(
            'tbody',
            {},
            bars.map((bar) =>
              h(
                'tr',
                {},
                h('th', { scope: 'row' }, weekLabel(bar.start)),
                h('td', {}, formats.decimal.format(bar.decided)),
                h('td', {}, formats.decimal.format(bar.sentAsWritten)),
                h('td', {}, bar.share === null ? strings.trust.noneYet : percentOf(bar.share)),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}

const measuredDisclosure = (report: AgentReport): HTMLElement =>
  h(
    'details',
    { class: 'trust-measured' },
    h('summary', {}, strings.trust.measuredTitle),
    h(
      'ul',
      {},
      Object.values(strings.trust.measured).map((line) => h('li', {}, line)),
      h('li', {}, strings.trust.quickExplained({ seconds: report.quickApprovalSeconds })),
    ),
    h('p', {}, strings.trust.measuredPrivacy),
  )
