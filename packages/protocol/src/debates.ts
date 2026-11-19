import { Schema as S } from '@homingbird/kernel'
import { DEBATE_PARTICIPANTS_MAX, DebateResult } from './debate-result.ts'
import { CredentialId, DebateId, MemberId, Timestamp } from './ids.ts'

export const DEBATE_QUESTION_MAX = 500
export const DebateQuestion = S.string({ minLength: 1, maxLength: DEBATE_QUESTION_MAX })

export const DebateVisibility = S.literal('open', 'private')
export type DebateVisibility = S.Infer<typeof DebateVisibility>

/** Closed has an approved result; ended has none, because too few agents came or none spoke. */
export const DebateStatus = S.literal('open', 'concluding', 'closed', 'ended')
export type DebateStatus = S.Infer<typeof DebateStatus>

/** Settings people choose; the room stops at whichever is reached first and asks for the result. */
export const DebateLimits = S.struct({
  turnsPerAgent: S.int({ min: 1, max: 20 }),
  totalTurns: S.int({ min: 2, max: 100 }),
  minutes: S.int({ min: 5, max: 10_080 }),
  turnCharacters: S.int({ min: 200, max: 4000 }),
})
export type DebateLimits = S.Infer<typeof DebateLimits>

export const DEFAULT_DEBATE_LIMITS: DebateLimits = {
  turnsPerAgent: 3,
  totalTurns: 9,
  minutes: 60,
  turnCharacters: 1200,
}

export const DEBATE_INVITEES_MAX = 50
export const DEBATE_TURN_MAX = 4000

export const DebateParticipant = S.struct({
  memberId: MemberId,
  /** Shown only to the participant's own person, for whom it names which of their agents takes part. */
  agentId: S.nullable(CredentialId),
  agentName: S.string({ maxLength: 200 }),
  joinedAt: Timestamp,
})
export type DebateParticipant = S.Infer<typeof DebateParticipant>

/** A turn is room content: shown to the room's members, never delivered as a note. */
export const DebateTurn = S.struct({
  position: S.int({ min: 1 }),
  memberId: MemberId,
  agentName: S.string({ maxLength: 200 }),
  body: S.string({ maxLength: DEBATE_TURN_MAX }),
  at: Timestamp,
})
export type DebateTurn = S.Infer<typeof DebateTurn>

export const DebateEnding = S.literal('too_few_agents', 'no_turns', 'no_result')
export type DebateEnding = S.Infer<typeof DebateEnding>

export const DebateApproval = S.struct({ memberId: MemberId, approvedAt: S.nullable(Timestamp) })
export type DebateApproval = S.Infer<typeof DebateApproval>

export const Debate = S.struct({
  id: DebateId,
  question: S.string({ maxLength: DEBATE_QUESTION_MAX }),
  visibility: DebateVisibility,
  status: DebateStatus,
  createdBy: MemberId,
  createdAt: Timestamp,
  deadlineAt: Timestamp,
  concludedAt: S.nullable(Timestamp),
  closedAt: S.nullable(Timestamp),
  endedBecause: S.nullable(DebateEnding),
  limits: DebateLimits,
  memberIds: S.array(MemberId),
  participants: S.array(DebateParticipant, { maxItems: DEBATE_PARTICIPANTS_MAX }),
  turns: S.array(DebateTurn),
  result: S.nullable(S.struct({ result: DebateResult, draftedBy: MemberId, draftedAt: Timestamp })),
  /** Counts the drafts people asked to replace, so a desk knows a declined result wants a new one. */
  resultRound: S.int({ min: 0 }),
  approvals: S.array(DebateApproval, { maxItems: DEBATE_PARTICIPANTS_MAX }),
})
export type Debate = S.Infer<typeof Debate>

export const DebateSummary = S.struct({
  id: DebateId,
  question: S.string({ maxLength: DEBATE_QUESTION_MAX }),
  visibility: DebateVisibility,
  status: DebateStatus,
  createdBy: MemberId,
  createdAt: Timestamp,
  deadlineAt: Timestamp,
  participantIds: S.array(MemberId, { maxItems: DEBATE_PARTICIPANTS_MAX }),
  turnCount: S.int({ min: 0 }),
  resultDrafted: S.boolean,
  joined: S.boolean,
})
export type DebateSummary = S.Infer<typeof DebateSummary>

export const DebateAsk = S.struct({ debate: Debate, ask: S.literal('turn', 'result') })
export type DebateAsk = S.Infer<typeof DebateAsk>

/** Names the drafted result a person approves or declines, so a decision never lands on a newer draft. */
export const DebateDecision = S.struct({ draftedAt: Timestamp })
export type DebateDecision = S.Infer<typeof DebateDecision>

export const DebateExportFormat = S.literal('markdown', 'json')
export type DebateExportFormat = S.Infer<typeof DebateExportFormat>

export const DebateExport = S.struct({
  filename: S.string({ minLength: 1, maxLength: 100 }),
  mediaType: S.literal('text/markdown', 'application/json'),
  text: S.string(),
})
export type DebateExport = S.Infer<typeof DebateExport>
