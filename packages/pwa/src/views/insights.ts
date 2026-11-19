import { Task as T } from '@homingbird/kernel'
import type {
  OrganizationFigures,
  OrganizationInsights,
  OrganizationPeriod,
  PlaceTotals,
} from '@homingbird/protocol'
import { type Lifetime, h, region, signal } from '@homingbird/ui'
import { api, launch } from '../actions.ts'
import { durationOf, formats, percentOf, strings } from '../strings.ts'
import {
  decidedOf,
  notesPerActiveMember,
  quickApprovalShare,
  replyRate,
  shareOf,
  skipShare,
} from '../trust.ts'
import { labelsTable, periodChoice, placeName } from './agent-trust.ts'
import { loading } from './parts.ts'

/** Organization-wide numbers for administrators: totals only, never a note, a person or a small group. */
export const insightsSection = (life: Lifetime): HTMLElement => {
  const loaded = signal<OrganizationInsights | null>(null)
  const days = signal(30)
  launch(T.map((insights: OrganizationInsights) => loaded.set(insights))(api['admin.insights']({})))
  return h(
    'div',
    { class: 'insights' },
    h('p', {}, strings.insights.intro),
    periodChoice('insights-period', days),
    region(life, [loaded, days], () => {
      const insights = loaded.get()
      if (insights === null) return loading()
      const period = insights.periods.find((each) => each.days === days.get()) ?? insights.periods[0]!
      return [
        h(
          'div',
          { class: 'flow-warning', role: 'note' },
          h('p', {}, strings.insights.noTeams),
          h('p', {}, strings.insights.privacy({ minimum: insights.minimumGroupSize })),
        ),
        period.current === null
          ? h(
              'p',
              { class: 'insights-too-few' },
              strings.insights.tooFew({ minimum: insights.minimumGroupSize }),
            )
          : [
              figuresTable(insights, period, period.current),
              placesTable(insights, period.current),
              labelsTable(
                'insights-by-client',
                strings.insights.byClientTitle,
                period.current.byClient,
                strings.trust.clientUnknown,
              ),
              labelsTable(
                'insights-by-model',
                strings.insights.byModelTitle,
                period.current.byModel,
                strings.trust.modelNotStated,
              ),
              period.current.hiddenLabels > 0 &&
                h(
                  'p',
                  { class: 'trust-footnote' },
                  strings.insights.hiddenLabels({ count: period.current.hiddenLabels }),
                ),
            ],
        h(
          'p',
          { class: 'insights-blocks' },
          insights.blocks === null
            ? strings.insights.blocksHidden({ minimum: insights.minimumGroupSize })
            : strings.insights.blocks({ count: insights.blocks }),
        ),
      ]
    }),
  )
}

const figuresTable = (
  insights: OrganizationInsights,
  period: OrganizationPeriod,
  current: OrganizationFigures,
): HTMLElement => {
  const rows = strings.insights.rows
  const line = (label: string, value: (figures: OrganizationFigures) => string): HTMLElement =>
    h(
      'tr',
      {},
      h('th', { scope: 'row' }, label),
      h('td', {}, value(current)),
      h('td', {}, period.previous === null ? strings.insights.hidden : value(period.previous)),
    )
  const decision = (figures: OrganizationFigures, count: (shown: Decided) => number): string => {
    const shown = decisionsShown(figures)
    return shown === null ? strings.insights.hidden : part(count(shown), decidedOf(shown))
  }
  const part = (count: number, total: number): string => {
    const share = shareOf(count, total)
    return share === null
      ? strings.trust.noneYet
      : strings.insights.partOf({ share: percentOf(share), count, total })
  }
  return h(
    'div',
    { class: 'table-scroll trust-table-scroll' },
    h(
      'table',
      { class: 'trust-table' },
      h('caption', {}, strings.insights.caption({ days: period.days })),
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
        line(rows.activeMembers, (figures) => formats.decimal.format(figures.activeMembers)),
        line(rows.notesPerMember, (figures) => formats.decimal.format(notesPerActiveMember(figures) ?? 0)),
        line(rows.replyRate, (figures) =>
          replyRate(figures) === null ? strings.trust.noneYet : part(figures.answered, figures.newNotes),
        ),
        line(rows.medianFirstReply, (figures) =>
          figures.medianFirstReplyMs === null
            ? strings.trust.noneYet
            : durationOf(figures.medianFirstReplyMs),
        ),
        line(rows.sentAsWritten, (figures) => decision(figures, (shown) => shown.sentAsWritten)),
        line(rows.sentAfterEdits, (figures) => decision(figures, (shown) => shown.sentAfterEdits)),
        line(rows.discarded, (figures) => decision(figures, (shown) => shown.discarded)),
        line(rows.quickShare, (figures) => {
          const shown = decisionsShown(figures)
          if (shown === null || figures.quickApprovals === null) return strings.insights.hidden
          return quickApprovalShare({ ...shown, quickApprovals: figures.quickApprovals }) === null
            ? strings.trust.noneYet
            : part(figures.quickApprovals, shown.sentAsWritten)
        }),
        line(rows.skipShare, (figures) =>
          skipShare(figures) === null
            ? strings.trust.noneYet
            : part(figures.skipped, figures.skipped + figures.agentDraftsWritten),
        ),
      ),
    ),
    h(
      'p',
      { class: 'trust-footnote' },
      strings.insights.quickExplained({ seconds: insights.quickApprovalSeconds }),
    ),
    h('p', { class: 'trust-footnote' }, strings.insights.skipExplained),
    decisionsShown(current) === null &&
      h(
        'p',
        { class: 'trust-footnote' },
        strings.insights.draftsHidden({ minimum: insights.minimumGroupSize }),
      ),
  )
}

const placesTable = (insights: OrganizationInsights, current: OrganizationFigures): HTMLElement =>
  h(
    'section',
    { class: 'trust-section', 'aria-labelledby': 'insights-places' },
    h('h2', { id: 'insights-places' }, strings.insights.placesTitle),
    current.places.length === 0
      ? h('p', {}, strings.insights.noPlaces)
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
                [
                  strings.insights.placeColumn,
                  strings.insights.notesColumn,
                  strings.insights.decidedColumn,
                  strings.insights.asWrittenColumn,
                  strings.insights.skippedColumn,
                ].map((heading) => h('th', { scope: 'col' }, heading)),
              ),
            ),
            h('tbody', {}, current.places.map(placeRow)),
          ),
        ),
    current.hiddenPlaces > 0 &&
      h('p', { class: 'trust-footnote' }, strings.insights.hiddenPlaces({ count: current.hiddenPlaces })),
  )

const placeRow = (place: PlaceTotals): HTMLElement => {
  const shown = decisionsShown(place)
  const share = shown === null ? null : shareOf(shown.sentAsWritten, decidedOf(shown))
  return h(
    'tr',
    {},
    h('th', { scope: 'row' }, placeName(place.place)),
    h('td', {}, formats.decimal.format(place.notesSent)),
    h('td', {}, shown === null ? strings.insights.hidden : formats.decimal.format(decidedOf(shown))),
    h(
      'td',
      {},
      shown === null ? strings.insights.hidden : share === null ? strings.trust.noneYet : percentOf(share),
    ),
    h('td', {}, formats.decimal.format(place.skipped)),
  )
}

interface Decided {
  readonly sentAsWritten: number
  readonly sentAfterEdits: number
  readonly discarded: number
}

/** A group's draft decisions, or null when too few people decided agent drafts in it to show them. */
const decisionsShown = (figures: {
  readonly sentAsWritten: number | null
  readonly sentAfterEdits: number | null
  readonly discarded: number | null
}): Decided | null =>
  figures.sentAsWritten === null || figures.sentAfterEdits === null || figures.discarded === null
    ? null
    : {
        sentAsWritten: figures.sentAsWritten,
        sentAfterEdits: figures.sentAfterEdits,
        discarded: figures.discarded,
      }
