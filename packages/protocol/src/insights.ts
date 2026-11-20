import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { MemberId, Timestamp } from './ids.ts'
import { ChannelSlug, RELEASE_REASON_MAX } from './model.ts'
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

/** The person's own notes in one period, whoever wrote them: what they sent and the answers on both sides. */
export const WeekFigures = S.struct({
  notesSent: count,
  repliesReceived: count,
  /** The typical time from a colleague's new note to the person's first reply to it. */
  medianReplyMs: S.nullable(count),
  /** Answers of channels' agents the person approved as a manager, never counted as notes they sent. */
  approvedForChannels: S.optional(count),
})
export type WeekFigures = S.Infer<typeof WeekFigures>

export const YourWeek = S.struct({ days: S.int({ min: 1 }), current: WeekFigures, previous: WeekFigures })
export type YourWeek = S.Infer<typeof YourWeek>

/** The signed-in person's own agent, for the last 7 and 30 days and the 8 weeks before now. */
export const AgentReport = S.struct({
  generatedAt: Timestamp,
  quickApprovalSeconds: S.int({ min: 1 }),
  minimumDecided: S.int({ min: 1 }),
  periods: S.array(AgentPeriod),
  weeks: S.array(TrustWeek),
  sessions: SessionHealth,
  week: S.optional(YourWeek),
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

export const Authorship = S.struct({ agent: count, humanEdited: count, human: count })
export type Authorship = S.Infer<typeof Authorship>

export const Delivery = S.struct({
  received: S.nullable(count),
  toAgents: count,
  pickedUpQuickly: count,
  medianPickupMs: S.nullable(count),
  waitedWithoutAgent: count,
})
export type Delivery = S.Infer<typeof Delivery>

/** A team's totals, counting each person for the whole UTC days they were in it; decisions null while hidden. */
export const TeamTotals = S.struct({
  team: S.string({ minLength: 1, maxLength: 80 }),
  activeMembers: count,
  notesSent: count,
  sentAsWritten: S.nullable(count),
  sentAfterEdits: S.nullable(count),
  discarded: S.nullable(count),
  quickApprovals: S.nullable(count),
  medianDecisionMs: S.nullable(count),
  skipped: count,
})
export type TeamTotals = S.Infer<typeof TeamTotals>

export const ChannelAgentTotals = S.struct({
  written: count,
  sentAsWritten: count,
  sentAfterEdits: count,
  discarded: count,
})
export type ChannelAgentTotals = S.Infer<typeof ChannelAgentTotals>

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
  medianDecisionMs: S.optional(S.nullable(count)),
  authorship: S.optional(S.nullable(Authorship)),
  delivery: S.optional(S.nullable(Delivery)),
  channelAgents: S.optional(S.nullable(ChannelAgentTotals)),
  teams: S.optional(S.array(TeamTotals)),
  hiddenTeams: S.optional(count),
})
export type OrganizationFigures = S.Infer<typeof OrganizationFigures>

export const OrganizationPeriod = S.struct({
  days: S.int({ min: 1 }),
  current: S.nullable(OrganizationFigures),
  previous: S.nullable(OrganizationFigures),
})
export type OrganizationPeriod = S.Infer<typeof OrganizationPeriod>

/** One week of drafts sent as written; both counts are null while too few people decided a draft that week. */
export const QuickWeek = S.struct({
  start: Timestamp,
  sentAsWritten: S.nullable(count),
  quickApprovals: S.nullable(count),
})
export type QuickWeek = S.Infer<typeof QuickWeek>

export const OrganizationInsights = S.struct({
  generatedAt: Timestamp,
  quickApprovalSeconds: S.int({ min: 1 }),
  minimumGroupSize: S.int({ min: 1 }),
  blocks: S.nullable(count),
  periods: S.array(OrganizationPeriod),
  weeks: S.optional(S.array(QuickWeek)),
  quickWarning: S.optional(S.boolean),
})
export type OrganizationInsights = S.Infer<typeof OrganizationInsights>

/** How many of a channel's agent's answers one manager sent: a count beside the others', never a rank. */
export const ManagerApprovals = S.struct({
  memberId: MemberId,
  name: S.string({ maxLength: 200 }),
  approved: count,
})
export type ManagerApprovals = S.Infer<typeof ManagerApprovals>

export const ChannelAgentFigures = S.struct({
  written: count,
  sentAsWritten: count,
  sentAfterEdits: count,
  discarded: count,
  medianDecisionMs: S.nullable(count),
  quickApprovals: count,
  approvals: S.nullable(S.array(ManagerApprovals)),
})
export type ChannelAgentFigures = S.Infer<typeof ChannelAgentFigures>

export const ChannelAgentPeriod = S.struct({
  days: S.int({ min: 1 }),
  current: ChannelAgentFigures,
  previous: ChannelAgentFigures,
})
export type ChannelAgentPeriod = S.Infer<typeof ChannelAgentPeriod>

/** How a channel's agent is doing, for the managers of its channel only. */
export const ChannelAgentReport = S.struct({
  generatedAt: Timestamp,
  channel: ChannelSlug,
  quickApprovalSeconds: S.int({ min: 1 }),
  minimumGroupSize: S.int({ min: 1 }),
  waiting: count,
  periods: S.array(ChannelAgentPeriod),
})
export type ChannelAgentReport = S.Infer<typeof ChannelAgentReport>

/** A person is nudged, and an organization warned, when this share of drafts sent as written was quick. */
export const QUICK_APPROVAL_SHARE = 0.25
export const QUICK_WARNING_WEEKS = 2
export const QUICK_WARNING_MINIMUM_AS_WRITTEN = 10
export const QUICK_PICKUP_MS = 5 * 60_000
export const PICKUP_WAIT_MS = 24 * 60 * 60_000
