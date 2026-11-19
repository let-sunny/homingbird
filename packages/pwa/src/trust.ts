import type { AsRead, OrganizationFigures, TrustWeek } from '@homingbird/protocol'

export type Change = 'up' | 'down' | 'same' | 'new'

export interface ShareComparison {
  readonly change: Change
  readonly share: number | null
  readonly before: number | null
}

/** How the sent-as-written share moved against the period before; a change within `tolerance` is "the same". */
export const compareSentAsWritten = (
  period: AsRead.AgentPeriod,
  tolerance = SAME_WITHIN,
): ShareComparison => {
  const share = sentAsWrittenShare(period.current)
  const before = sentAsWrittenShare(period.previous)
  return { change: changeBetween(share, before, tolerance), share, before }
}

export const changeBetween = (
  share: number | null,
  before: number | null,
  tolerance = SAME_WITHIN,
): Change =>
  share === null || before === null
    ? 'new'
    : Math.abs(share - before) <= tolerance
      ? 'same'
      : share > before
        ? 'up'
        : 'down'

export const shareOf = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null)

export const decidedOf = (figures: {
  readonly sentAsWritten: number
  readonly sentAfterEdits: number
  readonly discarded: number
}): number => figures.sentAsWritten + figures.sentAfterEdits + figures.discarded

export const PERIODS: ReadonlyArray<number> = [7, 30]

export const periodOf = (report: AsRead.AgentReport, days: number): AsRead.AgentPeriod =>
  report.periods.find((period) => period.days === days) ?? report.periods[0]!

export interface TrendBar {
  readonly start: number
  readonly decided: number
  readonly sentAsWritten: number
  readonly share: number | null
}

export const trendBars = (weeks: ReadonlyArray<TrustWeek>): TrendBar[] =>
  weeks.map((week) => ({ ...week, share: shareOf(week.sentAsWritten, week.decided) }))

export const replyRate = (figures: OrganizationFigures): number | null =>
  shareOf(figures.answered, figures.newNotes)

export const notesPerActiveMember = (figures: OrganizationFigures): number | null =>
  shareOf(figures.notesSent, figures.activeMembers)

export const quickApprovalShare = (figures: {
  readonly quickApprovals: number
  readonly sentAsWritten: number
}) => shareOf(figures.quickApprovals, figures.sentAsWritten)

/** Of everything agents finished, a draft or a skip, the share they skipped. */
export const skipShare = (figures: OrganizationFigures): number | null =>
  shareOf(figures.skipped, figures.skipped + figures.agentDraftsWritten)

export type DurationUnit = 'second' | 'minute' | 'hour' | 'day'

/** The largest unit that keeps the value at one or more, rounded to a whole number. */
export const durationParts = (ms: number): { readonly value: number; readonly unit: DurationUnit } => {
  const [unit, size] = DURATION_UNITS.find(([, size]) => ms >= size) ?? DURATION_UNITS.at(-1)!
  return { value: Math.round(ms / size), unit }
}

const SAME_WITHIN = 0.05

const DURATION_UNITS: ReadonlyArray<readonly [DurationUnit, number]> = [
  ['day', 24 * 60 * 60_000],
  ['hour', 60 * 60_000],
  ['minute', 60_000],
  ['second', 1000],
]

const sentAsWrittenShare = (figures: AsRead.AgentFigures): number | null =>
  shareOf(figures.sentAsWritten, decidedOf(figures))
