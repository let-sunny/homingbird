import { describe, expect, it } from 'vitest'
import { agentReportOf, channelAgentReportOf } from '../src/insights.ts'
import { verdictOf } from '../src/trust-verdict.ts'
import { demoApi, noteStarting, succeeded } from './support/demo.ts'

describe('agentReportOf', () => {
  it('reads the same numbers the same way, overall and in every place', () => {
    const { world, viewerId } = demoApi()
    const report = agentReportOf(world.records(), viewerId, world.startedAt, world.clock.now())
    for (const { current } of report.periods) {
      expect(current.verdict).toBe(
        verdictOf(current.sentAsWritten, current.sentAfterEdits, current.discarded),
      )
      for (const place of current.places)
        expect(place.verdict).toBe(verdictOf(place.sentAsWritten, place.sentAfterEdits, place.discarded))
    }
  })

  it('reports the seeded week and month, and counts each draft the visitor decides on top', async () => {
    const { api, world, viewerId } = demoApi()
    const before = agentReportOf(world.records(), viewerId, world.startedAt, world.clock.now())
    expect(before.periods.map((period) => period.days)).toEqual([7, 30])
    expect(before.weeks).toHaveLength(8)
    const draft = noteStarting(world, 'Yes. I checked')
    await succeeded(
      api['drafts.send']({
        params: { id: draft.id },
        body: {
          body: 'Yes, at 02:30.',
          expected: { body: draft.body, conversationId: draft.conversationId },
        },
      }),
    )
    const after = agentReportOf(world.records(), viewerId, world.startedAt, world.clock.now())
    expect(after.periods[0]!.current.written - before.periods[0]!.current.written).toBe(1)
    expect(after.periods[0]!.current.sentAfterEdits - before.periods[0]!.current.sentAfterEdits).toBe(1)
    expect(after.weeks.at(-1)!.decided - before.weeks.at(-1)!.decided).toBe(1)
    expect(after.week!.current.notesSent - before.week!.current.notesSent).toBe(1)
  })

  it('counts a discarded draft, and an answer approved for a channel apart from the visitor’s own', async () => {
    const { api, world, viewerId } = demoApi()
    const before = agentReportOf(world.records(), viewerId, world.startedAt, world.clock.now())
    await succeeded(
      api['drafts.discard']({ params: { id: noteStarting(world, 'Yes. I checked').id }, body: {} }),
    )
    const answer = noteStarting(world, 'Annual plans are refunded')
    await succeeded(
      api['drafts.send']({
        params: { id: answer.id },
        body: { expected: { body: answer.body, conversationId: answer.conversationId } },
      }),
    )
    const after = agentReportOf(world.records(), viewerId, world.startedAt, world.clock.now())
    expect(after.periods[1]!.current.discarded - before.periods[1]!.current.discarded).toBe(1)
    expect(after.week!.current.approvedForChannels! - before.week!.current.approvedForChannels!).toBe(1)
    expect(after.week!.current.notesSent).toBe(before.week!.current.notesSent)
  })
})

describe('channelAgentReportOf', () => {
  it('counts what is waiting, and each answer its managers decided since the demo started', async () => {
    const { api, world } = demoApi()
    const answer = noteStarting(world, 'Annual plans are refunded')
    const report = () =>
      channelAgentReportOf(world.records(), 'billing', answer.authorId, world.startedAt, world.clock.now())
    const before = report()
    expect(before.waiting).toBe(2)
    await succeeded(
      api['drafts.send']({
        params: { id: answer.id },
        body: { expected: { body: answer.body, conversationId: answer.conversationId } },
      }),
    )
    const after = report()
    expect(after.waiting).toBe(1)
    expect(after.periods[0]!.current.sentAsWritten - before.periods[0]!.current.sentAsWritten).toBe(1)
  })
})
