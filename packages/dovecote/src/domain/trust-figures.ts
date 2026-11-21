import {
  type AgentFigures,
  type AgentReport,
  type LabelTotals,
  type PlaceName,
  type PlaceTrust,
  QUICK_APPROVAL_SHARE,
  type SkipReason,
  TRUST_MINIMUM_DECIDED,
  type TrustVerdict,
  type TrustWeek,
} from '@homingbird/protocol'

import { sessionHealthOf } from './session-figures.ts'

export type DraftOutcome = 'as_written' | 'edited' | 'discarded'

/** A draft an agent wrote: `outcome` is null while it waits, and when something other than its person set it aside. */
export interface AgentDraft {
  readonly place: PlaceName
  readonly client?: string | null
  readonly model?: string | null
  readonly createdAt: number
  readonly seenAt: number | null
  readonly decidedAt: number | null
  readonly outcome: DraftOutcome | null
  readonly agentName?: string | null
  readonly sessionMinutes?: number | null
  readonly contextPercent?: number | null
}

export interface Skip {
  readonly place: PlaceName
  readonly at: number
  readonly reason: string | null
}

export interface Dated {
  readonly place: PlaceName
  readonly at: number
}

export interface AgentActivity {
  readonly drafts: ReadonlyArray<AgentDraft>
  readonly skips: ReadonlyArray<Skip>
  readonly expiredRequests: ReadonlyArray<Dated>
  readonly handWritten: ReadonlyArray<Dated>
  /** Debate results the person sent, counted apart from their agent's drafts and their own notes. */
  readonly debateResults?: ReadonlyArray<Dated>
}

export interface Window {
  readonly from: number
  readonly to: number
}

export interface Decisions {
  readonly sentAsWritten: number
  readonly sentAfterEdits: number
  readonly discarded: number
}

export const agentReportOf = (
  activity: AgentActivity,
  now: number,
  quickApprovalSeconds: number,
): AgentReport => ({
  generatedAt: now,
  quickApprovalSeconds,
  minimumDecided: TRUST_MINIMUM_DECIDED,
  periods: PERIOD_DAYS.map((days) => ({
    days,
    current: agentFiguresIn(activity, periodEndingAt(now, days, 0), quickApprovalSeconds),
    previous: agentFiguresIn(activity, periodEndingAt(now, days, 1), quickApprovalSeconds),
  })),
  weeks: weeksBefore(now, TREND_WEEKS).map((week) => weekOf(activity.drafts, week)),
  sessions: sessionHealthOf(activity.drafts, now),
})

export const agentFiguresIn = (
  activity: AgentActivity,
  window: Window,
  quickApprovalSeconds: number,
): AgentFigures => {
  const decided = activity.drafts.filter((draft) => isIn(window, draft.decidedAt) && draft.outcome !== null)
  const skips = activity.skips.filter((skip) => isIn(window, skip.at))
  const decisions = decisionsOf(decided)
  const quickApprovals = decided.filter((draft) => isQuickApproval(draft, quickApprovalSeconds)).length
  return {
    written: activity.drafts.filter((draft) => isIn(window, draft.createdAt)).length,
    ...decisions,
    skipped: skips.length,
    skipReasons: commonReasons(skips.map((skip) => skip.reason)),
    expiredRequests: activity.expiredRequests.filter((request) => isIn(window, request.at)).length,
    medianDecisionMs: median(decided.flatMap((draft) => decisionTime(draft) ?? [])),
    quickApprovals,
    quickApprovalsFrequent: isQuickApprovalFrequent(quickApprovals, decisions.sentAsWritten),
    wroteYourself: activity.handWritten.filter((note) => isIn(window, note.at)).length,
    debateResultsSent: (activity.debateResults ?? []).filter((note) => isIn(window, note.at)).length,
    verdict: verdictOf(decisions),
    places: placesIn(activity, window),
    byClient: clientTotals(activity.drafts, window),
    byModel: labelTotals(activity.drafts, window, (draft) => draft.model ?? null),
  }
}

/** Drafts written in the window and decisions made in it, grouped by a label; the busiest first, unknown last. */
export const labelTotals = <D extends AgentDraft>(
  drafts: ReadonlyArray<D>,
  window: Window,
  labelOf: (draft: D) => string | null,
): LabelTotals[] => {
  const groups = Map.groupBy(
    drafts.filter(
      (draft) => isIn(window, draft.createdAt) || (isIn(window, draft.decidedAt) && draft.outcome !== null),
    ),
    labelOf,
  )
  return [...groups]
    .map(([label, group]) => ({
      label,
      written: group.filter((draft) => isIn(window, draft.createdAt)).length,
      ...decisionsOf(group.filter((draft) => isIn(window, draft.decidedAt) && draft.outcome !== null)),
    }))
    .sort((a, b) => b.written - a.written || byPlace(a.label, b.label))
}

/** Drafts by the program that wrote them, each with the models its agents stated, most drafts first. */
export const clientTotals = <D extends AgentDraft>(drafts: ReadonlyArray<D>, window: Window): LabelTotals[] =>
  labelTotals(drafts, window, (draft) => draft.client ?? null).map((totals) => {
    const models = modelsStated(
      drafts.filter((draft) => (draft.client ?? null) === totals.label && isIn(window, draft.createdAt)),
    )
    return models.length === 0 ? totals : { ...totals, models }
  })

/** Plain-language reading of the decisions: never a score, and nothing until enough drafts were decided. */
export const verdictOf = (decisions: Decisions): TrustVerdict => {
  const decided = decidedCount(decisions)
  if (decided < TRUST_MINIMUM_DECIDED) return 'too_few'
  if (decisions.sentAsWritten >= USUALLY * decided) return 'usually_as_written'
  if (decisions.discarded >= OFTEN * decided && decisions.discarded >= decisions.sentAfterEdits)
    return 'often_discarded'
  if (decisions.sentAfterEdits >= OFTEN * decided) return 'often_edited'
  return 'mixed'
}

export const isQuickApproval = (draft: AgentDraft, quickApprovalSeconds: number): boolean => {
  const time = decisionTime(draft)
  return draft.outcome === 'as_written' && time !== null && time <= quickApprovalSeconds * 1000
}

export const isQuickApprovalFrequent = (quickApprovals: number, sentAsWritten: number): boolean =>
  quickApprovals >= QUICK_NUDGE_COUNT && quickApprovals >= QUICK_APPROVAL_SHARE * sentAsWritten

/** From the draft first appearing on its person's screen to their decision; null when either is unknown. */
export const decisionTime = (draft: AgentDraft): number | null =>
  draft.seenAt === null || draft.decidedAt === null || draft.outcome === null
    ? null
    : Math.max(0, draft.decidedAt - draft.seenAt)

export const median = (values: ReadonlyArray<number>): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

/** The most frequent reasons, compared without case or spacing, each shown as it was first written. */
export const commonReasons = (reasons: ReadonlyArray<string | null>, limit = REASONS_SHOWN): SkipReason[] => {
  const tally = new Map<string, { reason: string; count: number }>()
  for (const reason of reasons) {
    const written = reason?.trim().replace(/\s+/g, ' ') ?? ''
    if (written === '') continue
    const key = written.toLowerCase()
    const entry = tally.get(key) ?? { reason: written, count: 0 }
    tally.set(key, { ...entry, count: entry.count + 1 })
  }
  return [...tally.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

export const decidedCount = (decisions: Decisions): number =>
  decisions.sentAsWritten + decisions.sentAfterEdits + decisions.discarded

export const decisionsOf = (drafts: ReadonlyArray<{ readonly outcome: DraftOutcome | null }>): Decisions => ({
  sentAsWritten: drafts.filter((draft) => draft.outcome === 'as_written').length,
  sentAfterEdits: drafts.filter((draft) => draft.outcome === 'edited').length,
  discarded: drafts.filter((draft) => draft.outcome === 'discarded').length,
})

/** The current period stays open at its end: a note sent this instant may carry a time a few ms ahead, to keep its room in order. */
export const periodEndingAt = (now: number, days: number, periodsBack: number): Window => ({
  from: now - (periodsBack + 1) * days * DAY_MS,
  to: periodsBack === 0 ? Number.POSITIVE_INFINITY : now - periodsBack * days * DAY_MS,
})

export const weeksBefore = (now: number, count: number): Window[] =>
  Array.from({ length: count }, (_, index) => periodEndingAt(now, 7, count - 1 - index))

export const isIn = (window: Window, at: number | null): boolean =>
  at !== null && at > window.from && at <= window.to

export const byPlace = (a: PlaceName, b: PlaceName): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b)

export const PERIOD_DAYS: ReadonlyArray<number> = [7, 30]
export const TREND_WEEKS = 8
export const DAY_MS = 24 * 60 * 60_000

const USUALLY = 0.7
const OFTEN = 0.3
const QUICK_NUDGE_COUNT = 3
const REASONS_SHOWN = 3

const weekOf = (drafts: ReadonlyArray<AgentDraft>, week: Window): TrustWeek => {
  const decisions = decisionsOf(
    drafts.filter((draft) => isIn(week, draft.decidedAt) && draft.outcome !== null),
  )
  return { start: week.from, decided: decidedCount(decisions), sentAsWritten: decisions.sentAsWritten }
}

const placesIn = (activity: AgentActivity, window: Window): PlaceTrust[] => {
  const places = new Set<PlaceName>([
    ...activity.drafts
      .filter(
        (draft) => isIn(window, draft.createdAt) || (isIn(window, draft.decidedAt) && draft.outcome !== null),
      )
      .map((draft) => draft.place),
    ...activity.skips.filter((skip) => isIn(window, skip.at)).map((skip) => skip.place),
  ])
  return [...places]
    .map((place) => placeTrust(activity, window, place))
    .sort((a, b) => decidedCount(b) - decidedCount(a) || byPlace(a.place, b.place))
}

const placeTrust = (activity: AgentActivity, window: Window, place: PlaceName): PlaceTrust => {
  const drafts = activity.drafts.filter((draft) => draft.place === place)
  const decisions = decisionsOf(
    drafts.filter((draft) => isIn(window, draft.decidedAt) && draft.outcome !== null),
  )
  return {
    place,
    written: drafts.filter((draft) => isIn(window, draft.createdAt)).length,
    ...decisions,
    skipped: activity.skips.filter((skip) => skip.place === place && isIn(window, skip.at)).length,
    verdict: verdictOf(decisions),
  }
}

const modelsStated = (drafts: ReadonlyArray<AgentDraft>): string[] =>
  [
    ...Map.groupBy(
      drafts.flatMap((draft) => draft.model ?? []),
      (model) => model,
    ),
  ]
    .sort(([a, first], [b, second]) => second.length - first.length || a.localeCompare(b))
    .map(([model]) => model)
