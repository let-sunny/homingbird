import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { Timestamp } from './ids.ts'
import { RELEASE_REASON_MAX } from './model.ts'
import { SessionHealth } from './session-health.ts'

/** What the numbers say about one person's agent, in words a client renders; never a single score. */
export const TrustVerdict = S.tolerant(
  S.literal('too_few', 'usually_as_written', 'often_edited', 'often_discarded', 'mixed'),
  UNKNOWN,
)
export type TrustVerdict = S.Infer<typeof TrustVerdict>

/** A channel by its name, or null for direct and group messages together. */
export const PlaceName = S.nullable(S.string({ minLength: 1, maxLength: 200 }))
export type PlaceName = S.Infer<typeof PlaceName>

const count = S.int({ min: 0 })

export const SkipReason = S.struct({ reason: S.string({ maxLength: RELEASE_REASON_MAX }), count })
export type SkipReason = S.Infer<typeof SkipReason>

export const PlaceTrust = S.struct({
  place: PlaceName,
  written: count,
  sentAsWritten: count,
  sentAfterEdits: count,
  discarded: count,
  skipped: count,
  verdict: TrustVerdict,
})
export type PlaceTrust = S.Infer<typeof PlaceTrust>

/** Drafts by the program that wrote them, or by the model the agent stated; null means not stated or not known. */
export const LabelTotals = S.struct({
  label: S.nullable(S.string({ maxLength: 80 })),
  written: count,
  sentAsWritten: count,
  sentAfterEdits: count,
  discarded: count,
})
export type LabelTotals = S.Infer<typeof LabelTotals>

/** In the organization view, a label's decisions are null while too few people decided its drafts. */
export const OrganizationLabelTotals = S.struct({
  label: S.nullable(S.string({ maxLength: 80 })),
  written: count,
  sentAsWritten: S.nullable(count),
  sentAfterEdits: S.nullable(count),
  discarded: S.nullable(count),
})
export type OrganizationLabelTotals = S.Infer<typeof OrganizationLabelTotals>

export const AgentFigures = S.struct({
  written: count,
  sentAsWritten: count,
  sentAfterEdits: count,
  discarded: count,
  skipped: count,
  skipReasons: S.array(SkipReason),
  expiredRequests: count,
  medianDecisionMs: S.nullable(count),
  quickApprovals: count,
  quickApprovalsFrequent: S.boolean,
  wroteYourself: count,
  /** Debate results the person sent: counted apart, neither as agent drafts nor as notes they wrote. */
  debateResultsSent: S.optional(count),
  verdict: TrustVerdict,
  places: S.array(PlaceTrust),
  byClient: S.array(LabelTotals),
  byModel: S.array(LabelTotals),
})
export type AgentFigures = S.Infer<typeof AgentFigures>

export const AgentPeriod = S.struct({
  days: S.int({ min: 1 }),
  current: AgentFigures,
  previous: AgentFigures,
})
export type AgentPeriod = S.Infer<typeof AgentPeriod>

export const TrustWeek = S.struct({ start: Timestamp, decided: count, sentAsWritten: count })
export type TrustWeek = S.Infer<typeof TrustWeek>

/** The signed-in person's own agent, for the last 7 and 30 days and the 8 weeks before now. */
export const AgentReport = S.struct({
  generatedAt: Timestamp,
  quickApprovalSeconds: S.int({ min: 1 }),
  minimumDecided: S.int({ min: 1 }),
  periods: S.array(AgentPeriod),
  weeks: S.array(TrustWeek),
  sessions: SessionHealth,
})
export type AgentReport = S.Infer<typeof AgentReport>

export const PlaceTotals = S.struct({
  place: PlaceName,
  notesSent: count,
  sentAsWritten: S.nullable(count),
  sentAfterEdits: S.nullable(count),
  discarded: S.nullable(count),
  skipped: count,
})
export type PlaceTotals = S.Infer<typeof PlaceTotals>

/** Organization-wide counts only; draft decisions are null while too few people decided agent drafts. */
export const OrganizationFigures = S.struct({
  activeMembers: count,
  notesSent: count,
  newNotes: count,
  answered: count,
  medianFirstReplyMs: S.nullable(count),
  agentDraftsWritten: count,
  sentAsWritten: S.nullable(count),
  sentAfterEdits: S.nullable(count),
  discarded: S.nullable(count),
  quickApprovals: S.nullable(count),
  skipped: count,
  /** Debate results sent, apart from notes and drafts; null while fewer people than the minimum sent one. */
  debateResultsSent: S.optional(S.nullable(count)),
  places: S.array(PlaceTotals),
  hiddenPlaces: count,
  byClient: S.array(OrganizationLabelTotals),
  byModel: S.array(OrganizationLabelTotals),
  hiddenLabels: count,
})
export type OrganizationFigures = S.Infer<typeof OrganizationFigures>

export const OrganizationPeriod = S.struct({
  days: S.int({ min: 1 }),
  current: S.nullable(OrganizationFigures),
  previous: S.nullable(OrganizationFigures),
})
export type OrganizationPeriod = S.Infer<typeof OrganizationPeriod>

export const OrganizationInsights = S.struct({
  generatedAt: Timestamp,
  quickApprovalSeconds: S.int({ min: 1 }),
  minimumGroupSize: S.int({ min: 1 }),
  blocks: S.nullable(count),
  periods: S.array(OrganizationPeriod),
})
export type OrganizationInsights = S.Infer<typeof OrganizationInsights>
