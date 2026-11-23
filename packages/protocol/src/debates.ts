import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { DEBATE_GRACE_MINUTES } from './debate-grace.ts'
import { DEBATE_PARTICIPANTS_MAX, DebateResult } from './debate-result.ts'
import { FREE_SLOTS_MAX } from './free-slots.ts'
import { CredentialId, DebateId, MemberId, Timestamp } from './ids.ts'
import { MEETING_NOTICES_SHOWN_MAX, MeetingAttendance, MeetingInvite, MeetingNoticeShown } from './meeting.ts'
import { AgentLabel } from './model.ts'
import { RoomResult } from './room-result.ts'

export const DEBATE_QUESTION_MAX = 500
export const DebateQuestion = S.string({ minLength: 1, maxLength: DEBATE_QUESTION_MAX })

export const DebateVisibility = S.tolerant(S.literal('open', 'private'), UNKNOWN)
export type DebateVisibility = S.Infer<typeof DebateVisibility>

/** Closed has the result the agents settled; ended has none: too few agents came, none spoke or they left. */
export const RoomType = S.tolerant(S.literal('debate', 'scheduling'), UNKNOWN)
export type RoomType = S.Infer<typeof RoomType>

export const AttendeeAnswer = S.tolerant(S.literal('waiting', 'choosing', 'by_agent', 'by_person'), UNKNOWN)
export type AttendeeAnswer = S.Infer<typeof AttendeeAnswer>

export const RoomScheduleDetails = S.struct({
  minutes: S.int({ min: 15, max: 480 }),
  window: S.struct({ startsAt: Timestamp, endsAt: Timestamp }),
  attendees: S.array(
    S.struct({
      memberId: MemberId,
      required: S.boolean,
      answer: S.optional(AttendeeAnswer),
      attendance: S.optional(MeetingAttendance),
      /** When their part of the meeting last moved, so a client can tell an agent that never picked it up. */
      attendanceSince: S.optional(Timestamp),
    }),
    { maxItems: DEBATE_PARTICIPANTS_MAX },
  ),
  /** The invitation once sent, to the people invited and their agents only. */
  invite: S.optional(S.nullable(MeetingInvite)),
  /** The free times each attendee gave, to the people who see the room; to an agent, its own person's only. */
  freeSlots: S.optional(
    S.array(
      S.struct({
        memberId: MemberId,
        slots: S.array(S.struct({ startsAt: Timestamp, endsAt: Timestamp }), { maxItems: FREE_SLOTS_MAX }),
      }),
      { maxItems: DEBATE_PARTICIPANTS_MAX },
    ),
  ),
})
export type RoomScheduleDetails = S.Infer<typeof RoomScheduleDetails>

export const SCHEDULE_WINDOW_MAX_DAYS = 14

/** What a person opens a scheduling room with; they are always a required attendee themself. */
export const ScheduleSetup = S.struct({
  title: DebateQuestion,
  minutes: S.int({ min: 15, max: 480 }),
  window: S.struct({ startsAt: Timestamp, endsAt: Timestamp }),
  attendees: S.array(S.struct({ memberId: MemberId, required: S.boolean }), {
    minItems: 1,
    maxItems: DEBATE_PARTICIPANTS_MAX - 1,
  }),
  visibility: S.optional(DebateVisibility),
})
export type ScheduleSetup = S.Infer<typeof ScheduleSetup>

export const DebateStatus = S.tolerant(S.literal('open', 'concluding', 'closed', 'ended'), UNKNOWN)
export type DebateStatus = S.Infer<typeof DebateStatus>

const limitFields = {
  turnsPerAgent: S.int({ min: 1, max: 20 }),
  totalTurns: S.int({ min: 2, max: 100 }),
  minutes: S.int({ min: 5, max: 10_080 }),
  turnCharacters: S.int({ min: 200, max: 4000 }),
  graceMinutes: S.optional(S.tolerant(S.literal(...DEBATE_GRACE_MINUTES), UNKNOWN)),
}

/** Chosen at setup; `graceMinutes` is how long an unseen agent still takes part. */
export const DebateLimits = S.struct({
  ...limitFields,
  totalFollowsAgents: S.optional(S.boolean),
})
export type DebateLimits = S.Infer<typeof DebateLimits>

export const DebateLimitsWish = S.struct({
  ...limitFields,
  totalTurns: S.optional(limitFields.totalTurns),
})
export type DebateLimitsWish = S.Infer<typeof DebateLimitsWish>

export type DebateGraceMinutes = (typeof DEBATE_GRACE_MINUTES)[number]

export const DEFAULT_GRACE_MINUTES: DebateGraceMinutes = 5

export const TURNS_PER_AGENT_OFFERED = 4

export const DEFAULT_DEBATE_LIMITS = {
  turnsPerAgent: 3,
  minutes: 60,
  turnCharacters: 1200,
  graceMinutes: DEFAULT_GRACE_MINUTES,
} as const satisfies DebateLimitsWish

export const DEBATE_INVITEES_MAX = 50
export const DEBATE_TURN_MAX = 4000
export const DEBATE_BRIEF_MAX = 1000

export const DebateBrief = S.string({ maxLength: DEBATE_BRIEF_MAX })

export const DebateParticipant = S.struct({
  memberId: MemberId,
  /** Shown only to the participant's own person, for whom it names which of their agents takes part. */
  agentId: S.nullable(CredentialId),
  agentName: S.string({ maxLength: 200 }),
  joinedAt: Timestamp,
  takingPart: S.optional(S.boolean),
})
export type DebateParticipant = S.Infer<typeof DebateParticipant>

/** A turn is room content: shown to the room's members, never delivered as a note. */
export const DebateTurn = S.struct({
  position: S.int({ min: 1 }),
  memberId: MemberId,
  agentName: S.string({ maxLength: 200 }),
  body: S.string({ maxLength: DEBATE_TURN_MAX }),
  at: Timestamp,
  /** The model the agent said it ran as, shown to people as stated; null when it said none. */
  agentModel: S.optional(S.nullable(AgentLabel)),
  afterTurn: S.optional(S.nullable(S.int({ min: 0 }))),
  /** The agent said with this turn that it is ready to conclude; its next turn without it takes that back. */
  ready: S.optional(S.boolean),
})
export type DebateTurn = S.Infer<typeof DebateTurn>

export const DebateEnding = S.tolerant(
  S.literal('too_few_agents', 'no_turns', 'no_result', 'one_agent_left', 'no_agent_left'),
  UNKNOWN,
)
export type DebateEnding = S.Infer<typeof DebateEnding>

export const DebateConclusion = S.tolerant(S.literal('limit', 'time', 'agreed'), UNKNOWN)
export type DebateConclusion = S.Infer<typeof DebateConclusion>

/** A started room whose agents dropped out: one left taking part, or none. */
export type DebateEndingDetail = Extract<DebateEnding, 'one_agent_left' | 'no_agent_left'>

/** Shown once the room closed: who voted for whose draft, and who had dropped out. */
export const DebateVoteRecord = S.struct({
  votes: S.array(
    S.struct({ voterId: MemberId, draftBy: MemberId, agentModel: S.optional(S.nullable(AgentLabel)) }),
    { maxItems: DEBATE_PARTICIPANTS_MAX },
  ),
  droppedOut: S.array(MemberId, { maxItems: DEBATE_PARTICIPANTS_MAX }),
})
export type DebateVoteRecord = S.Infer<typeof DebateVoteRecord>

/** The one agent the room asks for a turn now, until when, and the agents it asks after it, in order. */
export const DebateAskedTurn = S.struct({
  memberId: MemberId,
  until: Timestamp,
  next: S.array(MemberId, { maxItems: DEBATE_PARTICIPANTS_MAX }),
})
export type DebateAskedTurn = S.Infer<typeof DebateAskedTurn>

export const DebateResultDraft = S.struct({
  draftedBy: MemberId,
  draftedAt: Timestamp,
  result: DebateResult,
  votes: S.nullable(S.int({ min: 0 })),
  agentModel: S.optional(S.nullable(AgentLabel)),
})
export type DebateResultDraft = S.Infer<typeof DebateResultDraft>

export const Debate = S.struct({
  id: DebateId,
  type: S.optional(RoomType),
  fromSuggestion: S.optional(S.boolean),
  schedule: S.optional(S.nullable(RoomScheduleDetails)),
  question: S.string({ maxLength: DEBATE_QUESTION_MAX }),
  visibility: DebateVisibility,
  status: DebateStatus,
  createdBy: MemberId,
  createdAt: Timestamp,
  deadlineAt: Timestamp,
  concludedAt: S.nullable(Timestamp),
  concludedBecause: S.optional(S.nullable(DebateConclusion)),
  closedAt: S.nullable(Timestamp),
  endedBecause: S.nullable(DebateEnding),
  limits: DebateLimits,
  memberIds: S.array(MemberId),
  participants: S.array(DebateParticipant, { maxItems: DEBATE_PARTICIPANTS_MAX }),
  turns: S.array(DebateTurn),
  askedTurn: S.optional(S.nullable(DebateAskedTurn)),
  /** `draftedBy` is null for a result the room computed itself. */
  result: S.nullable(S.struct({ result: RoomResult, draftedBy: S.nullable(MemberId), draftedAt: Timestamp })),
  resultRound: S.int({ min: 0 }),
  drafts: S.optional(S.array(DebateResultDraft, { maxItems: DEBATE_PARTICIPANTS_MAX })),
  draftsCloseAt: S.optional(S.nullable(Timestamp)),
  votingClosesAt: S.optional(S.nullable(Timestamp)),
  /** Who voted in this round, never for which draft while the vote runs. */
  votedBy: S.optional(S.array(MemberId, { maxItems: DEBATE_PARTICIPANTS_MAX })),
  voteRecord: S.optional(S.nullable(DebateVoteRecord)),
  brief: S.optional(S.nullable(DebateBrief)),
})
export type Debate = S.Infer<typeof Debate>

export const DebateSummary = S.struct({
  id: DebateId,
  type: S.optional(RoomType),
  question: S.string({ maxLength: DEBATE_QUESTION_MAX }),
  visibility: DebateVisibility,
  status: DebateStatus,
  createdBy: MemberId,
  createdAt: Timestamp,
  deadlineAt: Timestamp,
  participantIds: S.array(MemberId, { maxItems: DEBATE_PARTICIPANTS_MAX }),
  turnCount: S.int({ min: 0 }),
  totalTurns: S.int({ min: 0 }),
  resultDrafted: S.boolean,
  joined: S.boolean,
  fromSuggestion: S.optional(S.boolean),
  mine: S.optional(
    S.struct({
      answer: AttendeeAnswer,
      attendance: S.optional(MeetingAttendance),
      notices: S.array(MeetingNoticeShown, { maxItems: MEETING_NOTICES_SHOWN_MAX }),
    }),
  ),
})
export type DebateSummary = S.Infer<typeof DebateSummary>

export const DebateAsk = S.struct({
  debate: Debate,
  ask: S.tolerant(S.literal('turn', 'result', 'slots'), UNKNOWN),
})
export type DebateAsk = S.Infer<typeof DebateAsk>

export const MeetingAsk = S.struct({
  debate: Debate,
  ask: S.tolerant(S.literal('send_invite', 'accept_invite', 'decline_invite', 'cancel_invite'), UNKNOWN),
})
export type MeetingAsk = S.Infer<typeof MeetingAsk>

/** A room that ended without a result, as its agent learns of it: no words of the room, only why. */
export const DebateEnded = S.struct({ id: DebateId, endedBecause: DebateEnding, closedAt: Timestamp })
export type DebateEnded = S.Infer<typeof DebateEnded>

/** A vote as an agent casts it, with the model it says it ran as. */
export const DebateVote = S.struct({
  round: S.int({ min: 0 }),
  draftBy: MemberId,
  model: S.optional(AgentLabel),
})
export type DebateVote = S.Infer<typeof DebateVote>

export const DebateExportFormat = S.literal('markdown', 'json')
export type DebateExportFormat = S.Infer<typeof DebateExportFormat>

export const DebateExport = S.struct({
  filename: S.string({ minLength: 1, maxLength: 100 }),
  mediaType: S.tolerant(S.literal('text/markdown', 'application/json'), UNKNOWN),
  text: S.string(),
})
export type DebateExport = S.Infer<typeof DebateExport>
