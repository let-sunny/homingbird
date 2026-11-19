import { describe, expect, it } from 'vitest'
import { draftsItemModel } from '../../src/models/drafts-item.ts'
import { strings } from '../../src/strings.ts'
import {
  ANA,
  BEN,
  CY,
  ROOM,
  channel,
  conversation,
  draft,
  figures,
  note,
  principle,
  report,
  serverInfo,
  taught,
} from '../support/fixtures.ts'
import { threadInput } from '../support/thread.ts'

const item = (drafts: ReturnType<typeof draft>[], inReplyTo: string | null = null) => ({
  type: 'drafts' as const,
  key: `drafts:${drafts[0]!.id}`,
  inReplyTo: inReplyTo as never,
  drafts,
})

describe('draftsItemModel', () => {
  it('shows a new draft waiting for approval, where it goes, and the ways to decide on it', () => {
    const one = draft('d1')
    const model = draftsItemModel(threadInput(), item([one]))
    expect(model).toMatchObject({
      heading: strings.waitingForApproval,
      replyTo: strings.newNoteDraft,
      choose: null,
      archived: null,
    })
    expect(model.avatar).toMatchObject({ state: 'awaiting-approval', label: null })
    expect(model.cards[0]).toEqual({
      draft: one,
      origin: { className: 'origin is-agent', text: strings.originNamed.agent({ agent: 'Laptop' }) },
      body: 'body of d1',
      basis: null,
      applied: [],
      destination: { kind: 'people', text: strings.sendsTo({ names: 'Ben' }) },
      careful: null,
      actions: { alternatives: [], changeChannel: null },
    })
  })

  it('names the Claude Code desk and the runner on their drafts, apart, and without the desk’s host name', () => {
    const desk = draft('d1', { agentName: 'Homingbird CLI on ben-mac', agentClient: 'Claude Code 2.1.327' })
    const runner = draft('d2', {
      agentName: 'Homingbird CLI on ben-mac',
      agentClient: 'claude via homingbird run',
    })
    const cards = draftsItemModel(threadInput(), item([desk, runner])).cards
    expect(cards[0]!.origin.text).toBe(strings.originNamed.agent({ agent: strings.agentNames.desk }))
    expect(cards[1]!.origin.text).toBe(
      strings.originNamed.agent({ agent: strings.agentNames.runner({ host: 'ben-mac' }) }),
    )
    expect(cards[0]!.origin.text).not.toContain('ben-mac')
  })

  it('offers a choice between alternatives, and discards the others when one of a new note’s is sent', () => {
    const [a, b] = [draft('d1', { origin: 'human', agentName: null }), draft('d2', { agentName: null })]
    const model = draftsItemModel(threadInput(), item([a, b]))
    expect(model.choose).toBe(strings.chooseOne({ count: 2 }))
    expect(model.cards[0]!.origin.text).toBe(strings.origin.human)
    expect(model.cards[1]!.origin.text).toBe(strings.origin.agent)
    expect(model.cards[0]!.actions!.alternatives).toEqual([b])
    const question = note('q', { body: 'When?' })
    const replies = draftsItemModel(
      threadInput({ thread: { notes: [question], hasMore: false } }),
      item([draft('d3', { inReplyTo: 'q' as never }), draft('d4')], 'q'),
    )
    expect(replies.replyTo).toBe(strings.draftReplyTo({ excerpt: 'When?' }))
    expect(replies.cards[0]!.actions!.alternatives).toEqual([])
  })

  it('lists the principles applied in the basis order and leaves the agent’s own applied line out of the basis', () => {
    const principles = [principle('Tone'), principle('Billing dates')]
    const card = draftsItemModel(
      threadInput({ taught: taught({ principles }) }),
      item([draft('d1', { basis: 'Read RELEASES.md.\nPrinciples applied: Billing dates; Tone' })]),
    ).cards[0]!
    expect(card.basis).toEqual({ kind: 'given', lines: ['Read RELEASES.md.'] })
    expect(card.applied.map((marker) => marker.text)).toEqual([
      strings.teach.applied({ title: 'Billing dates' }),
      strings.teach.applied({ title: 'Tone' }),
    ])
    const untaught = draftsItemModel(
      threadInput(),
      item([draft('d1', { basis: 'Read it.\nPrinciples applied: Tone' })]),
    ).cards[0]!
    expect(untaught.basis).toEqual({ kind: 'given', lines: ['Read it.', 'Principles applied: Tone'] })
    expect(untaught.applied).toEqual([])
  })

  it('asks for a careful read of a risky draft from a person who approves quickly', () => {
    const quick = report({
      periods: [{ days: 7, current: figures({ quickApprovalsFrequent: true }), previous: figures() }],
    })
    const card = draftsItemModel(
      threadInput({ agentReport: quick }),
      item([draft('d1', { body: 'Ships on Friday.' })]),
    ).cards[0]!
    expect(card.careful).toBe(strings.carefulReading.date)
    const off = draftsItemModel(
      threadInput({ agentReport: quick, serverInfo: serverInfo() }),
      item([draft('d1', { body: 'Ships on Friday.' })]),
    )
    expect(off.cards[0]!.careful).toBeNull()
  })

  it('sends a channel question to the channel, a reply to its asker, and offers another channel', () => {
    const billing = channel('billing', { conversationId: ROOM })
    const room = conversation({ kind: 'channel', participantIds: [ANA, BEN, CY], title: 'billing' })
    const input = threadInput({ conversations: [room], channels: [billing] })
    const question = draftsItemModel(input, item([draft('d1')])).cards[0]!
    expect(question.destination).toEqual({
      kind: 'channel',
      text: strings.sendsToChannel({ channel: '#billing' }),
      channel: billing,
    })
    expect(question.actions!.changeChannel).toBe('billing')
    const asked = note('q', { authorId: BEN })
    const reply = draftsItemModel(
      threadInput({ conversations: [room], channels: [billing], thread: { notes: [asked], hasMore: false } }),
      item([draft('d2', { inReplyTo: 'q' as never })], 'q'),
    ).cards[0]!
    expect(reply.destination).toEqual({
      kind: 'people',
      text: strings.sendsToInRoom({ names: 'Ben', room: '#billing' }),
    })
    expect(reply.actions!.changeChannel).toBeNull()
    const unknown = draftsItemModel(threadInput({ conversations: [room] }), item([draft('d3')])).cards[0]!
    expect(unknown.destination).toEqual({
      kind: 'people',
      text: strings.sendsToInRoom({ names: '', room: '#billing' }),
    })
  })

  it('offers nothing to decide in an archived room, nor where the room is unknown', () => {
    const archived = draftsItemModel(
      threadInput({ conversations: [conversation({ archivedAt: 5 })] }),
      item([draft('d1')]),
    )
    expect(archived.archived).toBe(strings.archivedRoomNotice)
    expect(archived.cards[0]).toMatchObject({ destination: null, careful: null, actions: null })
    expect(
      draftsItemModel(threadInput({ conversations: [] }), item([draft('d1')])).cards[0]!.destination,
    ).toBeNull()
  })
})
