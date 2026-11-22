import { describe, expect, it } from 'vitest'
import {
  CHANNEL_DECISIONS_DAYS,
  CHANNEL_DECISIONS_MAX,
  ChannelDecision,
  ChannelDecisions,
} from '../src/channel-decisions.ts'

const decision = {
  noteId: 'note_answer0000000',
  conversationId: 'conv_room000000000',
  privately: false,
  outcome: 'sent_edited',
  decidedBy: 'mem_june000000000',
  decidedAt: 1_700_000_000_000,
  question: { id: 'note_question00000', authorId: 'mem_ben0000000000', body: 'Can I get a refund twice?' },
  answer: 'Ask Ana: duplicate refunds over 200 EUR need her.',
  agentAnswer: 'Yes, refunds are automatic.',
  reason: null,
  principles: [{ id: 'prin_refunds000001', topic: 'Refund window' }],
}

describe('ChannelDecision', () => {
  it('decodes each outcome a manager can reach', () => {
    for (const outcome of ['sent_as_written', 'sent_edited', 'discarded'])
      expect(ChannelDecision.decode({ ...decision, outcome })._tag).toBe('Ok')
  })

  it('refuses an outcome the server does not know, and a client reads it as unknown', () => {
    expect(ChannelDecision.decode({ ...decision, outcome: 'taken' })._tag).toBe('Err')
    expect(ChannelDecision.read({ ...decision, outcome: 'taken' })).toMatchObject({
      _tag: 'Ok',
      value: { outcome: 'unknown' },
    })
  })

  it('keeps who decided, the question and the agent’s own text optional', () => {
    expect(
      ChannelDecision.decode({
        ...decision,
        outcome: 'discarded',
        decidedBy: null,
        question: null,
        agentAnswer: null,
        reason: 'Policy changed in October.',
        principles: [],
      })._tag,
    ).toBe('Ok')
  })
})

describe('ChannelDecisions', () => {
  it('holds the last days of decisions, at most the cap', () => {
    const list = { channel: 'billing', days: CHANNEL_DECISIONS_DAYS, decisions: [decision] }
    expect(ChannelDecisions.decode(list)._tag).toBe('Ok')
    expect(CHANNEL_DECISIONS_DAYS).toBe(30)
    expect(
      ChannelDecisions.decode({
        ...list,
        decisions: Array.from({ length: CHANNEL_DECISIONS_MAX + 1 }, () => decision),
      })._tag,
    ).toBe('Err')
  })
})
