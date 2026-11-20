import type {
  ChannelAgentFigures,
  ChannelAgentReport,
  ChannelAgentTotals,
  ManagerApprovals,
  MemberId,
} from '@homingbird/protocol'
import {
  type AgentDraft,
  PERIOD_DAYS,
  type Window,
  decisionTime,
  decisionsOf,
  isIn,
  isQuickApproval,
  median,
  periodEndingAt,
} from './trust-figures.ts'

/** A channel's agent's answers over the periods its managers compare, with each manager's approvals. */
export const channelAgentReportOf = (
  channel: string,
  activity: ChannelAgentActivity,
  now: number,
  quickApprovalSeconds: number,
): ChannelAgentReport => ({
  generatedAt: now,
  channel,
  quickApprovalSeconds,
  waiting: activity.waiting,
  periods: PERIOD_DAYS.map((days) => ({
    days,
    current: channelAgentFiguresIn(activity, periodEndingAt(now, days, 0), quickApprovalSeconds),
    previous: channelAgentFiguresIn(activity, periodEndingAt(now, days, 1), quickApprovalSeconds),
  })),
})

/**
 * Every channel agent's answers together, for administrators: shown only while the people who sent
 * them reach the minimum, since a discard records no one and so cannot count as a decider.
 */
export const channelAgentTotalsIn = (
  drafts: ReadonlyArray<ReviewedDraft>,
  window: Window,
  minimum: number,
): ChannelAgentTotals | null => {
  const decided = decidedIn(drafts, window)
  const approvers = new Set(decided.flatMap((draft) => draft.approvedBy ?? []))
  if (approvers.size < minimum) return null
  return { written: drafts.filter((draft) => isIn(window, draft.createdAt)).length, ...decisionsOf(decided) }
}

export interface ReviewedDraft extends AgentDraft {
  /** The manager who sent it; null while it waits and when it was discarded. */
  readonly approvedBy: string | null
}

export interface ChannelAgentActivity {
  readonly drafts: ReadonlyArray<ReviewedDraft>
  readonly waiting: number
  readonly managers: ReadonlyArray<{ readonly id: MemberId; readonly name: string }>
}

const channelAgentFiguresIn = (
  activity: ChannelAgentActivity,
  window: Window,
  quickApprovalSeconds: number,
): ChannelAgentFigures => {
  const decided = decidedIn(activity.drafts, window)
  return {
    written: activity.drafts.filter((draft) => isIn(window, draft.createdAt)).length,
    ...decisionsOf(decided),
    medianDecisionMs: median(decided.flatMap((draft) => decisionTime(draft) ?? [])),
    quickApprovals: decided.filter((draft) => isQuickApproval(draft, quickApprovalSeconds)).length,
    approvals: approvalsBy(activity.managers, decided),
  }
}

const decidedIn = (drafts: ReadonlyArray<ReviewedDraft>, window: Window): ReviewedDraft[] =>
  drafts.filter((draft) => isIn(window, draft.decidedAt) && draft.outcome !== null)

const approvalsBy = (
  managers: ChannelAgentActivity['managers'],
  decided: ReadonlyArray<ReviewedDraft>,
): ManagerApprovals[] =>
  [...managers]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((manager) => ({
      memberId: manager.id,
      name: manager.name,
      approved: decided.filter((draft) => draft.approvedBy === manager.id && draft.outcome !== 'discarded')
        .length,
    }))
