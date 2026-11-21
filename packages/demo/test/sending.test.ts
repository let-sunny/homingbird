import { describe, expect, it } from 'vitest'
import { participantsOf, reviewersOf, saveDraft, sendDraft } from '../src/sending.ts'
import { demoApi, memberNamed, noteStarting } from './support/demo.ts'

describe('saveDraft', () => {
  it('announces a person’s draft to them alone, and a channel’s agent’s to the managers who did not ask (rule 2)', () => {
    const { world, viewerId } = demoApi()
    const ben = memberNamed(world, 'Ben Okafor')
    const ana = memberNamed(world, 'Ana Silva')
    const question = noteStarting(world, 'Who can explain the refund rule')
    const own = saveDraft(world, {
      conversationId: question.conversationId,
      authorId: viewerId,
      body: 'Mine',
      inReplyTo: null,
      agentName: null,
      basis: null,
    })
    expect(own.origin).toBe('human')
    expect(world.eventsAfter(ben, 0)).toEqual([])
    const answer = saveDraft(world, {
      conversationId: question.conversationId,
      authorId: noteStarting(world, 'Annual plans').authorId,
      body: 'Theirs',
      inReplyTo: question.id,
      agentName: 'Billing helper',
      basis: null,
    })
    expect(answer.origin).toBe('agent')
    expect(reviewersOf(world.records(), answer)).toEqual([viewerId, ana])
    expect(world.eventsAfter(ben, 0)).toEqual([])
    expect(world.eventsAfter(ana, 0).map((event) => event.body)).toEqual([
      { type: 'review.changed', noteId: answer.id },
    ])
  })
})

describe('sendDraft', () => {
  it('delivers a sent note, marks the question replied, and tells everyone who takes part', () => {
    const { world, viewerId } = demoApi()
    const draft = noteStarting(world, 'Yes. I checked')
    const sent = sendDraft(world, draft, { body: draft.body, approvedBy: null })
    expect(sent).toMatchObject({ status: 'sent', sentAt: world.clock.now() })
    expect(noteStarting(world, 'Is the billing migration safe').receipts[0]?.state).toBe('replied')
    for (const memberId of participantsOf(world.records(), sent.conversationId))
      expect(world.eventsAfter(memberId, 0).map((event) => event.body.type)).toContain('note.sent')
    expect(participantsOf(world.records(), 'conv_nowhere')).toEqual([])
    expect(viewerId).toBe(draft.authorId)
  })
})
