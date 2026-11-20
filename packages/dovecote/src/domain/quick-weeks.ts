import {
  QUICK_APPROVAL_SHARE,
  QUICK_WARNING_MINIMUM_AS_WRITTEN,
  QUICK_WARNING_WEEKS,
  type QuickWeek,
} from '@homingbird/protocol'
import { type MemberDraft, type PrivacySettings, peopleOf } from './organization-figures.ts'
import { TREND_WEEKS, type Window, isIn, isQuickApproval, weeksBefore } from './trust-figures.ts'

/**
 * Quick approvals among the drafts sent as written, week by week, and whether they stayed frequent for
 * the last weeks: each of them shown and with enough drafts sent as written to mean something.
 */
export const quickWeeksOf = (
  drafts: ReadonlyArray<MemberDraft>,
  now: number,
  settings: PrivacySettings,
): { readonly weeks: QuickWeek[]; readonly quickWarning: boolean } => {
  const weeks = weeksBefore(now, TREND_WEEKS).map((week) => quickWeekOf(drafts, week, settings))
  return { weeks, quickWarning: weeks.slice(-QUICK_WARNING_WEEKS).every(isQuickApprovalHigh) }
}

export const isQuickApprovalHigh = (week: QuickWeek): boolean =>
  week.sentAsWritten !== null &&
  week.quickApprovals !== null &&
  week.sentAsWritten >= QUICK_WARNING_MINIMUM_AS_WRITTEN &&
  week.quickApprovals >= QUICK_APPROVAL_SHARE * week.sentAsWritten

const quickWeekOf = (
  drafts: ReadonlyArray<MemberDraft>,
  week: Window,
  settings: PrivacySettings,
): QuickWeek => {
  const decided = drafts.filter((draft) => draft.outcome !== null && isIn(week, draft.decidedAt))
  const asWritten = decided.filter((draft) => draft.outcome === 'as_written')
  const shown = peopleOf(decided.map((draft) => draft.authorId)).size >= settings.minimumGroupSize
  return {
    start: week.from,
    sentAsWritten: shown ? asWritten.length : null,
    quickApprovals: shown
      ? asWritten.filter((draft) => isQuickApproval(draft, settings.quickApprovalSeconds)).length
      : null,
  }
}
