import {
  type OrganizationFigures,
  type OrganizationInsights,
  QUICK_APPROVAL_SHARE,
  QUICK_WARNING_WEEKS,
} from '@homingbird/protocol'
import { durationOf, formats, percentOf, strings } from '../strings.ts'
import { shareOf } from '../trust.ts'
import type { Trend } from './agent-figures.ts'

/** Who wrote what was sent, as shares of every sent note; hidden while the draft decisions are. */
export const authorshipModel = (figures: OrganizationFigures, minimum: number): AuthorshipModel => {
  const authorship = figures.authorship ?? null
  if (authorship === null)
    return {
      title: strings.measures.authorshipTitle,
      rows: [],
      hidden: strings.measures.authorshipHidden({ minimum }),
    }
  const total = authorship.agent + authorship.humanEdited + authorship.human
  const row = (key: string, count: number, line: (values: { share: string; count: number }) => string) => {
    const share = shareOf(count, total) ?? 0
    return { key, share, line: line({ share: percentOf(share), count }) }
  }
  return {
    title: strings.measures.authorshipTitle,
    rows: [
      row('agent', authorship.agent, strings.measures.authorshipAgent),
      row('edited', authorship.humanEdited, strings.measures.authorshipEdited),
      row('person', authorship.human, strings.measures.authorshipHuman),
    ],
    hidden: null,
  }
}

/** How received notes reached agents; hidden while too few people with an agent received one. */
export const deliveryModel = (figures: OrganizationFigures, minimum: number): DeliveryModel => {
  const delivery = figures.delivery ?? null
  const base = { title: strings.measures.deliveryTitle, intro: strings.measures.deliveryIntro }
  if (delivery === null) return { ...base, rows: [], hidden: strings.measures.deliveryHidden({ minimum }) }
  const part = (count: number, total: number): string => {
    const share = shareOf(count, total)
    return share === null
      ? strings.trust.noneYet
      : strings.insights.partOf({ share: percentOf(share), count, total })
  }
  return {
    ...base,
    rows: [
      [
        strings.measures.deliveryReceived,
        delivery.received === null ? strings.insights.hidden : formats.decimal.format(delivery.received),
      ],
      [
        strings.measures.deliveryToAgents,
        delivery.received === null
          ? formats.decimal.format(delivery.toAgents)
          : part(delivery.toAgents, delivery.received),
      ],
      [strings.measures.deliveryQuickly, part(delivery.pickedUpQuickly, delivery.toAgents)],
      [
        strings.measures.deliveryMedian,
        delivery.medianPickupMs === null ? strings.insights.hidden : durationOf(delivery.medianPickupMs),
      ],
      [strings.measures.deliveryWaited, part(delivery.waitedWithoutAgent, delivery.toAgents)],
    ],
    hidden: null,
  }
}

/** Quick approvals among drafts sent as written, week by week, or null from a server without the weeks. */
export const quickTrendModel = (insights: OrganizationInsights): Trend | null => {
  if (insights.weeks === undefined) return null
  const weekLabel = (start: number): string => formats.day.format(new Date(start))
  const weeks = insights.weeks.map((week) => {
    const shown =
      week.sentAsWritten === null || week.quickApprovals === null
        ? null
        : { asWritten: week.sentAsWritten, quick: week.quickApprovals }
    return { start: week.start, shown, share: shown === null ? null : shareOf(shown.quick, shown.asWritten) }
  })
  return {
    id: 'insights-quick-trend',
    title: strings.measures.quickTrendTitle,
    intro: strings.measures.quickTrendIntro({ seconds: insights.quickApprovalSeconds }),
    bars: weeks.map((week) => ({
      share: week.share,
      shareText: week.share === null ? '–' : percentOf(week.share),
      label: weekLabel(week.start),
      spoken:
        week.shown === null
          ? strings.measures.quickTrendHiddenWeek({ date: weekLabel(week.start) })
          : strings.measures.quickTrendWeek({
              date: weekLabel(week.start),
              quick: week.shown.quick,
              asWritten: week.shown.asWritten,
            }),
    })),
    tableSummary: strings.measures.quickTrendTable,
    headings: [
      strings.trust.weekColumn,
      strings.measures.asWrittenColumn,
      strings.measures.quickColumn,
      strings.trust.shareColumn,
    ],
    rows: weeks.map(
      (week) =>
        [
          weekLabel(week.start),
          week.shown === null ? strings.insights.hidden : formats.decimal.format(week.shown.asWritten),
          week.shown === null ? strings.insights.hidden : formats.decimal.format(week.shown.quick),
          week.shown === null
            ? strings.insights.hidden
            : week.share === null
              ? strings.trust.noneYet
              : percentOf(week.share),
        ] as const,
    ),
  }
}

/** The warning that approving may be becoming a formality, or null while it is not. */
export const quickWarningModel = (insights: OrganizationInsights): string | null =>
  insights.quickWarning === true
    ? strings.measures.quickWarning({
        weeks: QUICK_WARNING_WEEKS,
        share: percentOf(QUICK_APPROVAL_SHARE),
        seconds: insights.quickApprovalSeconds,
      })
    : null

export interface AuthorshipModel {
  readonly title: string
  readonly rows: ReadonlyArray<{ readonly key: string; readonly share: number; readonly line: string }>
  readonly hidden: string | null
}

export interface DeliveryModel {
  readonly title: string
  readonly intro: string
  readonly rows: ReadonlyArray<readonly [string, string]>
  readonly hidden: string | null
}
