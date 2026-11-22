import {
  CHANNEL_DECISIONS_DAYS,
  CHANNEL_DECISIONS_MAX,
  type ChannelDecision,
  type ChannelDecisions,
  type MemberId,
} from '@homingbird/protocol'
import type { ChannelRecord, DecisionRecord, Records } from './world.ts'

/**
 * What the managers of a channel decided on its agent's answers in the last days, newest first, as
 * Dovecote answers a manager: never a decision on a question the viewer asked (rule 2).
 */
export const channelDecisionsOf = (
  records: Records,
  viewerId: MemberId,
  channel: ChannelRecord,
  now: number,
): ChannelDecisions => ({
  channel: channel.slug,
  days: CHANNEL_DECISIONS_DAYS,
  decisions: records.decisions
    .filter((decided) => decided.decidedAt >= now - CHANNEL_DECISIONS_DAYS * DAY_MS)
    .flatMap((decided) => decisionOf(records, viewerId, channel, decided))
    .sort((one, other) => other.decidedAt - one.decidedAt)
    .slice(0, CHANNEL_DECISIONS_MAX),
})

const DAY_MS = 24 * 60 * 60_000

const decisionOf = (
  records: Records,
  viewerId: MemberId,
  channel: ChannelRecord,
  decided: DecisionRecord,
): ChannelDecision[] => {
  const note = records.notes.find((each) => each.id === decided.noteId)
  if (note === undefined || note.authorId !== channel.agentId) return []
  const room = records.conversations.find((each) => each.id === note.conversationId)
  const question = records.notes.find((each) => each.id === note.inReplyTo) ?? null
  if (question?.authorId === viewerId || room?.privateQuestionOf?.askedBy === viewerId) return []
  const outcome =
    note.status === 'discarded' ? 'discarded' : note.origin === 'agent' ? 'sent_as_written' : 'sent_edited'
  return [
    {
      noteId: note.id,
      conversationId: note.conversationId,
      privately: room?.privateQuestionOf !== undefined,
      outcome,
      decidedBy: decided.decidedBy,
      decidedAt: decided.decidedAt,
      question:
        question === null ? null : { id: question.id, authorId: question.authorId, body: question.body },
      answer: note.body,
      agentAnswer: outcome === 'sent_edited' ? decided.agentAnswer : null,
      reason: outcome === 'discarded' ? decided.reason : null,
      principles: [],
    },
  ]
}
