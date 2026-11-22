import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { ConversationId, MemberId, NoteId, Timestamp } from './ids.ts'
import { ChannelSlug, DiscardReason, NOTE_BODY_MAX } from './model.ts'
import { PRINCIPLES_PER_PERSON, PRINCIPLE_TOPIC_MAX, PrincipleId } from './principles.ts'

/** A channel's agent's answer as one of its managers sent or discarded it; an unknown outcome is never taught from. */
export const ChannelDecision = S.struct({
  noteId: NoteId,
  conversationId: ConversationId,
  privately: S.boolean,
  outcome: S.tolerant(S.literal('sent_as_written', 'sent_edited', 'discarded'), UNKNOWN),
  /** Null for a discard recorded before discards named who. */
  decidedBy: S.nullable(MemberId),
  decidedAt: Timestamp,
  question: S.nullable(
    S.struct({ id: NoteId, authorId: MemberId, body: S.string({ maxLength: NOTE_BODY_MAX }) }),
  ),
  answer: S.string({ maxLength: NOTE_BODY_MAX }),
  agentAnswer: S.nullable(S.string({ maxLength: NOTE_BODY_MAX })),
  reason: S.nullable(DiscardReason),
  principles: S.array(S.struct({ id: PrincipleId, topic: S.string({ maxLength: PRINCIPLE_TOPIC_MAX }) }), {
    maxItems: PRINCIPLES_PER_PERSON,
  }),
})
export type ChannelDecision = S.Infer<typeof ChannelDecision>
export type ChannelDecisionOutcome = ChannelDecision['outcome']

export const CHANNEL_DECISIONS_DAYS = 30
export const CHANNEL_DECISIONS_MAX = 100

/** Never a decision on a question the viewer asked, whose draft was hidden from them (rule 2). */
export const ChannelDecisions = S.struct({
  channel: ChannelSlug,
  days: S.int({ min: 1 }),
  decisions: S.array(ChannelDecision, { maxItems: CHANNEL_DECISIONS_MAX }),
})
export type ChannelDecisions = S.Infer<typeof ChannelDecisions>
