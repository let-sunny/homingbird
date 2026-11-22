import type {
  OrganizationFigures,
  OrganizationInsights,
  OrganizationPeriod,
  PlaceTotals,
  TeamTotals,
} from '@homingbird/protocol'
import { durationOf, formats, percentOf, strings } from '../strings.ts'
import {
  decidedOf,
  notesPerActiveMember,
  quickApprovalShare,
  replyRate,
  shareOf,
  skipShare,
} from '../trust.ts'
import {
  type LabelsTable,
  type MeasuredLink,
  type Trend,
  labelsTableModel,
  measuredLink,
} from './agent-figures.ts'
import {
  type AuthorshipModel,
  type DeliveryModel,
  authorshipModel,
  deliveryModel,
  quickTrendModel,
  quickWarningModel,
} from './insights-sections.ts'
import { placeName } from './places.ts'

/**
 * Organization-wide numbers for administrators: totals only, never a note, a person or a small group.
 * At a minimum group of 1 a notice says so until the administrator dismissed it in this browser.
 */
export const insightsModel = (
  insights: OrganizationInsights | null,
  days: number,
  isMinimumNoticeDismissed: boolean,
): InsightsModel => {
  if (insights === null) return { kind: 'loading' }
  const period = insights.periods.find((each) => each.days === days) ?? insights.periods[0]!
  const current = period.current
  const showsEveryGroup = insights.minimumGroupSize <= 1
  return {
    kind: 'insights',
    minimumNotice:
      showsEveryGroup && !isMinimumNoticeDismissed
        ? { text: strings.insights.minimumNotice, dismiss: strings.insights.minimumNoticeDismiss }
        : null,
    groupRule: showsEveryGroup
      ? strings.insights.minimumOne
      : strings.insights.privacy({ minimum: insights.minimumGroupSize }),
    warnings: hasTeams(current) ? [] : [strings.insights.noTeams],
    quickWarning: quickWarningModel(insights),
    tooFew: current === null ? strings.insights.tooFew({ minimum: insights.minimumGroupSize }) : null,
    figures:
      current === null
        ? null
        : {
            table: figuresTable(insights, period, current),
            places: placesTable(current),
            teams: hasTeams(current)
              ? teamsTable(current.teams ?? [], current.hiddenTeams ?? 0, insights.minimumGroupSize)
              : null,
            authorship: authorshipModel(current, insights.minimumGroupSize),
            delivery: deliveryModel(current, insights.minimumGroupSize),
            byClient: labelsTableModel(
              'insights-by-client',
              strings.insights.byClientTitle,
              current.byClient,
              strings.trust.clientUnknown,
            ),
            byModel: labelsTableModel(
              'insights-by-model',
              strings.insights.byModelTitle,
              current.byModel,
              strings.trust.modelNotStated,
            ),
            hiddenLabels: hiddenLabelsText(current.hiddenLabels, showsEveryGroup),
          },
    quickTrend: quickTrendModel(insights),
    blocks:
      insights.blocks === null
        ? strings.insights.blocksHidden({ minimum: insights.minimumGroupSize })
        : strings.insights.blocks({ count: insights.blocks }),
    measured: measuredLink(),
  }
}

export type InsightsModel =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'insights'
      /** Shown until dismissed while figures can describe one person. */
      readonly minimumNotice: { readonly text: string; readonly dismiss: string } | null
      /** Which minimum group is in force, and what it means for one person's figures. */
      readonly groupRule: string
      readonly warnings: ReadonlyArray<string>
      readonly quickWarning: string | null
      readonly tooFew: string | null
      readonly figures: {
        readonly table: InsightsTable
        readonly places: InsightsPlaces
        readonly teams: InsightsPlaces | null
        readonly authorship: AuthorshipModel
        readonly delivery: DeliveryModel
        readonly byClient: LabelsTable | null
        readonly byModel: LabelsTable | null
        readonly hiddenLabels: string | null
      } | null
      readonly quickTrend: Trend | null
      readonly blocks: string
      readonly measured: MeasuredLink
    }

export interface InsightsTable {
  readonly caption: string
  readonly headings: readonly [string, string, string]
  readonly rows: ReadonlyArray<readonly [string, string, string]>
  readonly footnotes: ReadonlyArray<string>
}

export interface InsightsPlaces {
  readonly title: string
  readonly none: string | null
  readonly headings: ReadonlyArray<string>
  readonly rows: ReadonlyArray<ReadonlyArray<string>>
  readonly hidden: string | null
  readonly footnote?: string
}

interface Decided {
  readonly sentAsWritten: number
  readonly sentAfterEdits: number
  readonly discarded: number
}

const figuresTable = (
  insights: OrganizationInsights,
  period: OrganizationPeriod,
  current: OrganizationFigures,
): InsightsTable => {
  const rows = strings.insights.rows
  const line = (label: string, value: (figures: OrganizationFigures) => string) =>
    [
      label,
      value(current),
      period.previous === null ? strings.insights.hidden : value(period.previous),
    ] as const
  const part = (count: number, total: number): string => {
    const share = shareOf(count, total)
    return share === null
      ? strings.trust.noneYet
      : strings.insights.partOf({ share: percentOf(share), count, total })
  }
  const decision = (figures: OrganizationFigures, count: (shown: Decided) => number): string => {
    const shown = decisionsShown(figures)
    return shown === null ? strings.insights.hidden : part(count(shown), decidedOf(shown))
  }
  return {
    caption: strings.insights.caption({ days: period.days }),
    headings: [
      strings.trust.what,
      strings.trust.lastDays({ days: period.days }),
      strings.trust.before({ days: period.days }),
    ],
    rows: [
      line(rows.activeMembers, (figures) => formats.decimal.format(figures.activeMembers)),
      line(rows.notesPerMember, (figures) => formats.decimal.format(notesPerActiveMember(figures) ?? 0)),
      line(rows.replyRate, (figures) =>
        replyRate(figures) === null ? strings.trust.noneYet : part(figures.answered, figures.newNotes),
      ),
      line(rows.medianFirstReply, (figures) =>
        figures.medianFirstReplyMs === null ? strings.trust.noneYet : durationOf(figures.medianFirstReplyMs),
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
      line(rows.debateResultsSent, (figures) =>
        figures.debateResultsSent == null
          ? strings.insights.hidden
          : formats.decimal.format(figures.debateResultsSent),
      ),
      line(rows.answeredFromHistory, (figures) => formats.decimal.format(figures.answeredFromHistory ?? 0)),
      line(strings.measures.decisionTimeRow, (figures) =>
        figures.medianDecisionMs == null
          ? missing(insights.minimumGroupSize)
          : durationOf(figures.medianDecisionMs),
      ),
      ...(current.channelAgents === undefined ? [] : channelAgentRows(line)),
    ],
    footnotes: [
      ...(current.channelAgents === undefined
        ? []
        : [
            insights.minimumGroupSize <= 1
              ? strings.insights.channelAgentsCounted
              : strings.insights.channelAgentsExplained({ minimum: insights.minimumGroupSize }),
          ]),
      insights.minimumGroupSize <= 1
        ? strings.insights.debateResultsCounted
        : strings.insights.debateResultsExplained({ minimum: insights.minimumGroupSize }),
      strings.insights.quickExplained({ seconds: insights.quickApprovalSeconds }),
      strings.insights.skipExplained,
      ...(decisionsShown(current) === null
        ? [strings.insights.draftsHidden({ minimum: insights.minimumGroupSize })]
        : []),
    ],
  }
}

/** Every channel's agent's answers together; a period shows them only when enough managers sent one. */
const channelAgentRows = (
  line: (label: string, value: (figures: OrganizationFigures) => string) => readonly [string, string, string],
) => {
  const rows = strings.insights.rows
  const shown =
    (count: (totals: NonNullable<OrganizationFigures['channelAgents']>) => number) =>
    (figures: OrganizationFigures) =>
      figures.channelAgents == null
        ? strings.insights.hidden
        : formats.decimal.format(count(figures.channelAgents))
  return [
    line(
      rows.channelAgentAnswers,
      shown((totals) => totals.written),
    ),
    line(
      rows.channelAgentAsWritten,
      shown((totals) => totals.sentAsWritten),
    ),
    line(
      rows.channelAgentEdited,
      shown((totals) => totals.sentAfterEdits),
    ),
    line(
      rows.channelAgentDiscarded,
      shown((totals) => totals.discarded),
    ),
  ]
}

const hasTeams = (current: OrganizationFigures | null): boolean =>
  current !== null && (current.teams ?? []).length + (current.hiddenTeams ?? 0) > 0

/** Every team shown, alphabetically as the server sends them, never ranked. */
const teamsTable = (teams: ReadonlyArray<TeamTotals>, hidden: number, minimum: number): InsightsPlaces => {
  const labels = strings.insights
  const count = (value: number | null) => (value === null ? labels.hidden : formats.decimal.format(value))
  return {
    title: labels.teamsTitle,
    none: teams.length === 0 ? labels.noTeamRows : null,
    headings: [
      labels.teamColumn,
      labels.peopleColumn,
      labels.notesColumn,
      labels.asWrittenColumn,
      labels.editedColumn,
      labels.discardedColumn,
      labels.quickColumn,
      labels.decisionTimeColumn,
      labels.skippedColumn,
    ],
    rows: teams.map((team) => [
      team.team,
      count(team.activeMembers),
      count(team.notesSent),
      count(team.sentAsWritten),
      count(team.sentAfterEdits),
      count(team.discarded),
      count(team.quickApprovals),
      team.medianDecisionMs === null ? missing(minimum) : durationOf(team.medianDecisionMs),
      count(team.skipped),
    ]),
    hidden: hidden > 0 ? labels.hiddenTeams({ count: hidden }) : null,
    footnote: labels.teamsExplained,
  }
}

const placesTable = (current: OrganizationFigures): InsightsPlaces => ({
  title: strings.insights.placesTitle,
  none: current.places.length === 0 ? strings.insights.noPlaces : null,
  headings: [
    strings.insights.placeColumn,
    strings.insights.notesColumn,
    strings.insights.decidedColumn,
    strings.insights.asWrittenColumn,
    strings.insights.skippedColumn,
    strings.insights.answeredFromHistoryColumn,
  ],
  rows: current.places.map(placeRow),
  hidden: current.hiddenPlaces > 0 ? strings.insights.hiddenPlaces({ count: current.hiddenPlaces }) : null,
})

const placeRow = (place: PlaceTotals): ReadonlyArray<string> => {
  const shown = decisionsShown(place)
  const share = shown === null ? null : shareOf(shown.sentAsWritten, decidedOf(shown))
  return [
    placeName(place.place),
    formats.decimal.format(place.notesSent),
    shown === null ? strings.insights.hidden : formats.decimal.format(decidedOf(shown)),
    shown === null ? strings.insights.hidden : share === null ? strings.trust.noneYet : percentOf(share),
    formats.decimal.format(place.skipped),
    formats.decimal.format(place.answeredFromHistory ?? 0),
  ]
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

/** An empty median: hidden only when a minimum group could have hidden it, otherwise not measured yet. */
const missing = (minimum: number): string => (minimum <= 1 ? strings.trust.noneYet : strings.insights.hidden)

/** Labels always need two people, so at a minimum of 1 those hidden are each one person's. */
const hiddenLabelsText = (hidden: number, showsEveryGroup: boolean): string | null => {
  if (hidden === 0) return null
  return showsEveryGroup
    ? strings.insights.hiddenLabelsOnePerson({ count: hidden })
    : strings.insights.hiddenLabels({ count: hidden })
}
