import { Schema as S } from '@homingbird/kernel'
import { DEBATE_PARTICIPANTS_MAX } from './debate-result.ts'
import { DEFAULT_GRACE_MINUTES, DebateBrief, type DebateLimitsWish, DebateQuestion } from './debates.ts'
import { ConversationId, DebateId, MemberId, NoteId, Timestamp } from './ids.ts'

export const SuggestionId = S.brand<'SuggestionId'>()(
  S.string({ pattern: /^sugg_[0-9a-z]{12,}$/, maxLength: 45 }),
)
export type SuggestionId = S.Infer<typeof SuggestionId>

export const SUGGESTION_REASON_MAX = 300
export const SUGGESTED_MEMBERS_MAX = DEBATE_PARTICIPANTS_MAX - 1
export const SUGGESTIONS_PER_PERSON = 20

/** An agent's suggestion to talk a note over before it answers: never a room until its person opens one. */
export const DebateSuggestion = S.struct({
  id: SuggestionId,
  inReplyTo: NoteId,
  conversationId: ConversationId,
  draftId: S.nullable(NoteId),
  question: DebateQuestion,
  memberIds: S.array(MemberId, { maxItems: SUGGESTED_MEMBERS_MAX }),
  reason: S.string({ maxLength: SUGGESTION_REASON_MAX }),
  agentName: S.string({ maxLength: 200 }),
  createdAt: Timestamp,
})
export type DebateSuggestion = S.Infer<typeof DebateSuggestion>

export const SuggestionInput = S.closed(
  S.struct({
    inReplyTo: NoteId,
    question: DebateQuestion,
    memberIds: S.array(MemberId, { minItems: 1, maxItems: SUGGESTED_MEMBERS_MAX }),
    reason: S.string({ minLength: 1, maxLength: SUGGESTION_REASON_MAX }),
    draftId: S.optional(NoteId),
  }),
)
export type SuggestionInput = S.Infer<typeof SuggestionInput>

export const SuggestionAcceptance = S.closed(
  S.struct({
    question: S.optional(DebateQuestion),
    memberIds: S.optional(S.array(MemberId, { minItems: 1, maxItems: SUGGESTED_MEMBERS_MAX })),
    brief: S.optional(DebateBrief),
  }),
)
export type SuggestionAcceptance = S.Infer<typeof SuggestionAcceptance>

/** A suggested room ended: its agent drafts the answer with `debateId`, or alone without a result. */
export const DebateAnswerAsk = S.struct({
  debateId: DebateId,
  suggestionId: SuggestionId,
  inReplyTo: NoteId,
  draftId: S.nullable(NoteId),
  hasResult: S.boolean,
})
export type DebateAnswerAsk = S.Infer<typeof DebateAnswerAsk>

export const SHORT_DEBATE_LIMITS = {
  turnsPerAgent: 2,
  minutes: 30,
  turnCharacters: 1200,
  graceMinutes: DEFAULT_GRACE_MINUTES,
} as const satisfies DebateLimitsWish
