import type { AsRead, LabelTotals, OrganizationLabelTotals } from '@homingbird/protocol'
import { shortLabel } from '../authorship.ts'
import { clientLabel } from '../client-labels.ts'
import { hrefFor } from '../routes.ts'
import { durationOf, formats, listOf, percentOf, strings } from '../strings.ts'
import { PERIODS, compareSentAsWritten, decidedOf, periodOf, shareOf, trendBars } from '../trust.ts'
import { placeName } from './places.ts'

/** How the agent is doing over a period: the verdict first, then the numbers, places, labels and trend. */
export const figuresModel = (report: AsRead.AgentReport | 'failed' | null, days: number): FiguresModel => {
  if (report === null) return { kind: 'loading' }
  if (report === 'failed') return { kind: 'failed', text: strings.trust.loadFailed }
  const period = periodOf(report, days)
  return {
    kind: 'figures',
    report,
    headline: headline(report, period),
    table: numbersTable(report, period),
    skips: skipReasons(period.current),
    places: places(period.current),
    byClient: labelsTableModel(
      'trust-by-client',
      strings.trust.byClientTitle,
      period.current.byClient,
      strings.trust.clientUnknown,
    ),
    byModel: labelsTableModel(
      'trust-by-model',
      strings.trust.byModelTitle,
      period.current.byModel,
      strings.trust.modelNotStated,
    ),
    trend: trend(report),
    measured: {
      title: strings.trust.measuredTitle,
      lines: [
        ...Object.values(strings.trust.measured),
        strings.trust.quickExplained({ seconds: report.quickApprovalSeconds }),
      ],
      privacy: strings.trust.measuredPrivacy,
      link: measuredLink(),
    },
  }
}

/** The periods to choose between, the chosen one checked. */
export const periodChoices = (chosen: number): ReadonlyArray<PeriodChoice> =>
  PERIODS.map((days) => ({ days, label: strings.trust.lastDays({ days }), checked: days === chosen }))

/** Drafts by the program that wrote them, or by the model the agent stated, as a table; none without rows. */
export const labelsTableModel = (
  id: string,
  title: string,
  rows: ReadonlyArray<LabelTotals | OrganizationLabelTotals>,
  unknown: string,
): LabelsTable | null =>
  rows.length === 0
    ? null
    : {
        id,
        title,
        headings: [
          strings.trust.labelColumn,
          strings.trust.rows.written,
          strings.trust.rows.sentAsWritten,
          strings.trust.rows.sentAfterEdits,
          strings.trust.rows.discarded,
        ],
        rows: rows.map((row) => ({
          title: row.label === null ? unknown : clientLabel(row.label),
          label: row.label === null ? unknown : shortLabel(clientLabel(row.label)),
          models:
            'models' in row && row.models !== undefined && row.models.length > 0
              ? strings.trust.modelsUsed({ models: listOf(row.models) })
              : null,
          cells: [row.written, row.sentAsWritten, row.sentAfterEdits, row.discarded].map((value) =>
            value === null ? strings.insights.hidden : formats.decimal.format(value),
          ),
        })),
      }

export type FiguresModel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly text: string }
  | {
      readonly kind: 'figures'
      readonly report: AsRead.AgentReport
      readonly headline: Headline
      readonly table: FiguresTable
      readonly skips: Skips | null
      readonly places: Places | null
      readonly byClient: LabelsTable | null
      readonly byModel: LabelsTable | null
      readonly trend: Trend
      readonly measured: {
        readonly title: string
        readonly lines: ReadonlyArray<string>
        readonly privacy: string
        readonly link: MeasuredLink
      }
    }

/** The way to "What is measured", the page every member can open. */
export const measuredLink = (): MeasuredLink => ({
  href: hrefFor({ name: 'measured' }),
  label: strings.measures.pageLink,
})

export interface MeasuredLink {
  readonly href: string
  readonly label: string
}

export interface PeriodChoice {
  readonly days: number
  readonly label: string
  readonly checked: boolean
}

export interface Headline {
  readonly verdictClass: string
  readonly verdict: string
  readonly basis: string
  readonly change: string | null
  readonly teach: string
  readonly nudge: { readonly title: string; readonly detail: string } | null
}

export interface FiguresTable {
  readonly caption: string
  readonly headings: readonly [string, string, string]
  readonly rows: ReadonlyArray<readonly [string, string, string]>
  readonly footnotes: ReadonlyArray<string>
}

export interface Skips {
  readonly title: string
  readonly reasons: ReadonlyArray<string>
  readonly none: string | null
}

export interface Places {
  readonly title: string
  readonly intro: string
  readonly rows: ReadonlyArray<{
    readonly key: string
    readonly line: string
    readonly share: number | null
    readonly verdict: string | null
    readonly skipped: string | null
  }>
}

export interface LabelsTable {
  readonly id: string
  readonly title: string
  readonly headings: ReadonlyArray<string>
  readonly rows: ReadonlyArray<{
    readonly title: string
    readonly label: string
    /** On a program's row, the models its agents stated. */
    readonly models: string | null
    readonly cells: ReadonlyArray<string>
  }>
}

export interface Trend {
  readonly id: string
  readonly title: string
  readonly intro: string
  readonly bars: ReadonlyArray<{
    readonly share: number | null
    readonly shareText: string
    readonly label: string
    readonly spoken: string
  }>
  readonly tableSummary: string
  readonly headings: ReadonlyArray<string>
  readonly rows: ReadonlyArray<readonly [string, string, string, string]>
}

const headline = (report: AsRead.AgentReport, period: AsRead.AgentPeriod): Headline => {
  const figures = period.current
  const decided = decidedOf(figures)
  const comparison = compareSentAsWritten(period)
  return {
    verdictClass: `is-${figures.verdict.replaceAll('_', '-')}`,
    verdict: strings.trust.verdict[figures.verdict],
    basis:
      figures.verdict === 'too_few'
        ? strings.trust.tooFewBasis({ count: decided, days: period.days, minimum: report.minimumDecided })
        : strings.trust.basis({ count: decided, asWritten: figures.sentAsWritten, days: period.days }),
    change: comparison.share === null ? null : comparisonText(comparison, comparison.share),
    teach: strings.trust.teach[figures.verdict],
    nudge: figures.quickApprovalsFrequent
      ? {
          title: strings.trust.nudge,
          detail: strings.trust.nudgeDetail({
            count: figures.quickApprovals,
            seconds: report.quickApprovalSeconds,
          }),
        }
      : null,
  }
}

const comparisonText = (comparison: ReturnType<typeof compareSentAsWritten>, current: number): string => {
  const share = percentOf(current)
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

const numbersTable = (report: AsRead.AgentReport, period: AsRead.AgentPeriod): FiguresTable => {
  const rows = strings.trust.rows
  const hasAutoSent = (period.current.autoSent ?? 0) + (period.previous.autoSent ?? 0) > 0
  const line = (label: string, value: (figures: AsRead.AgentFigures) => string) =>
    [label, value(period.current), value(period.previous)] as const
  const counted = (pick: (figures: AsRead.AgentFigures) => number) => (figures: AsRead.AgentFigures) =>
    formats.decimal.format(pick(figures))
  const withShare = (pick: (figures: AsRead.AgentFigures) => number) => (figures: AsRead.AgentFigures) => {
    const share = shareOf(pick(figures), decidedOf(figures))
    const count = formats.decimal.format(pick(figures))
    return share === null ? count : strings.trust.countAndShare({ count, share: percentOf(share) })
  }
  return {
    caption: strings.trust.caption({ days: period.days }),
    headings: [
      strings.trust.what,
      strings.trust.lastDays({ days: period.days }),
      strings.trust.before({ days: period.days }),
    ],
    rows: [
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
      line(
        rows.debateResultsSent,
        counted((figures) => figures.debateResultsSent ?? 0),
      ),
      ...(hasAutoSent
        ? [
            line(
              rows.autoSent,
              counted((figures) => figures.autoSent ?? 0),
            ),
          ]
        : []),
    ],
    footnotes: [
      strings.trust.quickExplained({ seconds: report.quickApprovalSeconds }),
      strings.trust.debateResultsExplained,
    ],
  }
}

const skipReasons = (figures: AsRead.AgentFigures): Skips | null =>
  figures.skipped === 0
    ? null
    : {
        title: strings.trust.skipsTitle,
        reasons: figures.skipReasons.map((entry) =>
          strings.trust.skipReason({ reason: entry.reason, count: entry.count }),
        ),
        none: figures.skipReasons.length === 0 ? strings.trust.noSkipReasons : null,
      }

const places = (figures: AsRead.AgentFigures): Places | null =>
  figures.places.length === 0
    ? null
    : {
        title: strings.trust.placesTitle,
        intro: strings.trust.placesIntro,
        rows: figures.places.map((place) => {
          const decided = decidedOf(place)
          const name = placeName(place.place)
          return {
            key: place.place ?? 'direct',
            line:
              decided === 0
                ? strings.trust.placeNothingDecided({ place: name })
                : strings.trust.placeLine({ place: name, asWritten: place.sentAsWritten, decided }),
            share: shareOf(place.sentAsWritten, decided),
            verdict: decided > 0 ? strings.trust.verdict[place.verdict] : null,
            skipped: place.skipped > 0 ? strings.trust.placeSkipped({ count: place.skipped }) : null,
          }
        }),
      }

const trend = (report: AsRead.AgentReport): Trend => {
  const bars = trendBars(report.weeks)
  const weekLabel = (start: number): string => formats.day.format(new Date(start))
  return {
    id: 'trust-trend',
    title: strings.trust.trendTitle,
    intro: strings.trust.trendIntro,
    bars: bars.map((bar) => ({
      share: bar.share,
      shareText: bar.share === null ? '–' : percentOf(bar.share),
      label: weekLabel(bar.start),
      spoken:
        bar.decided === 0
          ? strings.trust.trendEmptyWeek({ date: weekLabel(bar.start) })
          : strings.trust.trendWeek({
              date: weekLabel(bar.start),
              asWritten: bar.sentAsWritten,
              decided: bar.decided,
            }),
    })),
    tableSummary: strings.trust.trendTable,
    headings: [
      strings.trust.weekColumn,
      strings.trust.decidedColumn,
      strings.trust.rows.sentAsWritten,
      strings.trust.shareColumn,
    ],
    rows: bars.map(
      (bar) =>
        [
          weekLabel(bar.start),
          formats.decimal.format(bar.decided),
          formats.decimal.format(bar.sentAsWritten),
          bar.share === null ? strings.trust.noneYet : percentOf(bar.share),
        ] as const,
    ),
  }
}
