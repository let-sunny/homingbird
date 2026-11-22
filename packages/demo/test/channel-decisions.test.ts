import { makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, noteStarting, refused, succeeded } from './support/demo.ts'

const BILLING = { slug: 'billing' }

const onClock = () => {
  const clock = makeTestClock(NOW)
  return { clock, ...demoApi(VISITOR_ID, createWorld(clock)) }
}

describe('the recent decisions of #billing', () => {
  it('starts with the answer Ana sent as written', async () => {
    const { api, world } = demoApi()
    const listed = await succeeded(api['channels.agent.decisions']({ params: BILLING }))
    expect(listed).toMatchObject({ channel: 'billing', days: 30 })
    expect(listed.decisions).toEqual([
      expect.objectContaining({
        outcome: 'sent_as_written',
        decidedBy: memberNamed(world, 'Ana Silva'),
        question: expect.objectContaining({ body: 'Which invoices does the nightly export skip?' }),
        agentAnswer: null,
        reason: null,
        privately: false,
      }),
    ])
  })

  it('adds June’s edit and discard, newest first, with the agent’s words and her reason', async () => {
    const { api, world, viewerId, clock } = onClock()
    const inRoom = noteStarting(world, 'Annual plans are refunded')
    const privately = noteStarting(world, 'You can refund a duplicate payment')
    await succeeded(
      api['drafts.send']({
        params: { id: inRoom.id },
        body: {
          body: 'Ask Ana about annual plans.',
          expected: { body: inRoom.body, conversationId: inRoom.conversationId },
        },
      }),
    )
    await clock.advance(60_000)
    await succeeded(
      api['drafts.discard']({ params: { id: privately.id }, body: { reason: ' Needs Ana over 200 EUR. ' } }),
    )
    const [discarded, edited] = (await succeeded(api['channels.agent.decisions']({ params: BILLING })))
      .decisions
    expect(discarded).toMatchObject({
      noteId: privately.id,
      outcome: 'discarded',
      decidedBy: viewerId,
      privately: true,
      reason: 'Needs Ana over 200 EUR.',
      agentAnswer: null,
    })
    expect(edited).toMatchObject({
      noteId: inRoom.id,
      outcome: 'sent_edited',
      answer: 'Ask Ana about annual plans.',
      agentAnswer: inRoom.body,
      reason: null,
    })
  })

  it('keeps a discard without a reason, and leaves out decisions older than thirty days', async () => {
    const { api, world, clock } = onClock()
    const privately = noteStarting(world, 'You can refund a duplicate payment')
    await succeeded(api['drafts.discard']({ params: { id: privately.id }, body: {} }))
    expect((await succeeded(api['channels.agent.decisions']({ params: BILLING }))).decisions[0]!.reason).toBe(
      null,
    )
    await clock.advance(31 * 24 * 60 * 60_000)
    expect((await succeeded(api['channels.agent.decisions']({ params: BILLING }))).decisions).toEqual([])
  })

  it('hides a decision from the manager who asked, the list from anyone who does not manage the channel, and skips a note that is gone', async () => {
    const { world } = demoApi()
    const kai = demoApi(memberNamed(world, 'Kai Lin'), world)
    expect((await refused(kai.api['channels.agent.decisions']({ params: BILLING })))?._tag).toBe('NotFound')
    const ana = demoApi(memberNamed(world, 'Ana Silva'), world)
    const ben = memberNamed(world, 'Ben Okafor')
    const asked = noteStarting(world, 'Annual plans are refunded')
    await succeeded(
      ana.api['drafts.send']({
        params: { id: asked.id },
        body: { expected: { body: asked.body, conversationId: asked.conversationId } },
      }),
    )
    world.update((records) => ({
      ...records,
      decisions: [
        ...records.decisions,
        { noteId: 'note_missing00000' as never, decidedBy: ben, decidedAt: 0, agentAnswer: '', reason: null },
      ],
    }))
    const benAsManager = demoApi(ben, world)
    world.update((records) => ({
      ...records,
      groups: records.groups.map((group) =>
        group.memberIds.includes(memberNamed(world, 'Ana Silva'))
          ? { ...group, memberIds: [...group.memberIds, ben] }
          : group,
      ),
    }))
    const seen = await succeeded(benAsManager.api['channels.agent.decisions']({ params: BILLING }))
    expect(seen.decisions.map((each) => each.noteId)).toEqual([
      noteStarting(world, 'Drafts and invoices still under review').id,
    ])
    const anas = await succeeded(ana.api['channels.agent.decisions']({ params: BILLING }))
    expect(anas.decisions.map((each) => each.noteId)).toContain(asked.id)
  })
})
