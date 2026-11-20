import type {
  ChannelAgentFigures,
  ChannelAgentReport,
  ChannelAgentTotals,
  ManagerApprovals,
  MemberId,
} from '@homingbird/protocol'
import { isEnough, peopleOf, placesShown } from './disclosure.ts'
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
  settings: { readonly quickApprovalSeconds: number; readonly minimumGroupSize: number },
): ChannelAgentReport => ({
  generatedAt: now,
  channel,
  quickApprovalSeconds: settings.quickApprovalSeconds,
  minimumGroupSize: settings.minimumGroupSize,
  waiting: activity.waiting,
  periods: PERIOD_DAYS.map((days) => ({
    days,
    current: channelAgentFiguresIn(activity, periodEndingAt(now, days, 0), settings),
    previous: channelAgentFiguresIn(activity, periodEndingAt(now, days, 1), settings),
  })),
})

/** Every channel agent's answers, hidden unless they and the organization's other decisions each have the minimum. */
export const channelAgentTotalsIn = (
  drafts: ReadonlyArray<ReviewedDraft>,
  organizationDecided: ReadonlyArray<{ readonly id?: string; readonly authorId: string | null }>,
  window: Window,
  minimum: number,
): ChannelAgentTotals | null => {
  const decided = decidedIn(drafts, window)
  const counted = new Set<string | undefined>(decided.map((draft) => draft.id))
  const others = organizationDecided.filter((draft) => !counted.has(draft.id))
  const groups = [
    { place: ANSWERS, people: peopleOf(decided.map((draft) => draft.approvedBy)) },
    ...(others.length === 0
      ? []
      : [{ place: OTHERS, people: peopleOf(others.map((draft) => draft.authorId)) }]),
  ]
  if (!placesShown(groups, minimum).shown.includes(ANSWERS)) return null
  return { written: drafts.filter((draft) => isIn(window, draft.createdAt)).length, ...decisionsOf(decided) }
}

export interface ReviewedDraft extends AgentDraft {
  readonly id: string
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
  settings: { readonly quickApprovalSeconds: number; readonly minimumGroupSize: number },
): ChannelAgentFigures => {
  const decided = decidedIn(activity.drafts, window)
  const current = new Set<string>(activity.managers.map((manager) => manager.id))
  const approvers = peopleOf(decided.map((draft) => draft.approvedBy))
  return {
    written: activity.drafts.filter((draft) => isIn(window, draft.createdAt)).length,
    ...decisionsOf(decided),
    medianDecisionMs: median(decided.flatMap((draft) => decisionTime(draft) ?? [])),
    quickApprovals: decided.filter((draft) => isQuickApproval(draft, settings.quickApprovalSeconds)).length,
    approvals: isEnough(approvers.size, settings.minimumGroupSize)
      ? approvalsBy(activity.managers, decided)
      : null,
    approvedByFormerManagers: decided.filter(
      (draft) => draft.approvedBy !== null && !current.has(draft.approvedBy),
    ).length,
  }
}

const ANSWERS = 'channel agents'
const OTHERS = 'other decisions'

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
