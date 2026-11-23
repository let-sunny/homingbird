import { makeTestClock } from '@homingbird/kernel'
import { SHORT_DEBATE_LIMITS } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { DEBATE_JOIN_AFTER_MS, DEBATE_TURN_AFTER_MS } from '../src/debate-script.ts'
import { JUST_ANSWER_AFTER_MS } from '../src/suggestion-handlers.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, noteStarting, refused, succeeded } from './support/demo.ts'

describe('debate suggestions', () => {
  it('shows one suggestion from the visitor’s agent about Kai’s question, who is left out of the flock', async () => {
    const { api, world } = started()
    const { suggestions } = await succeeded(api['debateSuggestions.list']({}))
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({
      inReplyTo: noteStarting(world, 'Heads up: the deploy window').id,
      memberIds: [memberNamed(world, 'Ana Silva')],
      askerId: memberNamed(world, 'Kai Lin'),
      agentName: "June's laptop",
      createdAt: NOW - 20 * 60_000,
    })
  })

  it('opens a short flock from it, where Ana’s agent joins and a scripted debate settles a result', async () => {
    const { api, world, clock } = started()
    const [suggestion] = (await succeeded(api['debateSuggestions.list']({}))).suggestions
    const room = await succeeded(
      api['debateSuggestions.accept']({
        params: { id: suggestion!.id },
        body: { question: ' Can it still run? ', brief: ' Keep it short. ' },
      }),
    )
    expect(room).toMatchObject({
      fromSuggestion: true,
      question: 'Can it still run?',
      visibility: 'private',
      brief: 'Keep it short.',
      limits: { turnsPerAgent: SHORT_DEBATE_LIMITS.turnsPerAgent },
      participants: [{ memberId: VISITOR_ID, agentId: 'cred_demojunelapt' }],
    })
    expect((await succeeded(api['debateSuggestions.list']({}))).suggestions).toEqual([])
    expect(
      (await succeeded(api['debates.list']({}))).debates.find((each) => each.id === room.id),
    ).toMatchObject({ fromSuggestion: true })
    await clock.advance(DEBATE_JOIN_AFTER_MS + DEBATE_TURN_AFTER_MS * 6)
    const closed = world.records().debates.find((each) => each.id === room.id)!
    expect(closed).toMatchObject({ status: 'closed', result: { result: { kind: 'conclusion' } } })
    expect(closed.turns).toHaveLength(4)
  })

  it('opens a flock with nobody to ask when the visitor took everyone out', async () => {
    const { api, clock, world } = started()
    const [suggestion] = (await succeeded(api['debateSuggestions.list']({}))).suggestions
    const room = await succeeded(
      api['debateSuggestions.accept']({ params: { id: suggestion!.id }, body: { memberIds: [VISITOR_ID] } }),
    )
    await clock.advance(DEBATE_JOIN_AFTER_MS * 2)
    expect(room.memberIds).toEqual([VISITOR_ID])
    expect(world.records().debates[0]?.participants).toHaveLength(1)
  })

  it('drafts the agent’s answer to Kai when the visitor says to just answer', async () => {
    const { api, world, clock } = started()
    const [suggestion] = (await succeeded(api['debateSuggestions.list']({}))).suggestions
    const drafts = () =>
      world
        .records()
        .notes.filter((note) => note.status === 'draft' && note.inReplyTo === suggestion!.inReplyTo)
    await succeeded(api['debateSuggestions.dismiss']({ params: { id: suggestion!.id } }))
    expect((await succeeded(api['debateSuggestions.list']({}))).suggestions).toEqual([])
    expect(drafts()).toEqual([])
    await clock.advance(JUST_ANSWER_AFTER_MS)
    expect(drafts().map((note) => [note.authorId, note.agentName, note.body.startsWith('No clash')])).toEqual(
      [[VISITOR_ID, "June's laptop", true]],
    )
  })

  it('refuses a suggestion that is gone, or an empty question', async () => {
    const { api } = started()
    const [suggestion] = (await succeeded(api['debateSuggestions.list']({}))).suggestions
    expect(
      await refused(api['debateSuggestions.accept']({ params: { id: 'sugg_nothere000000' }, body: {} })),
    ).toMatchObject({ _tag: 'NotFound' })
    expect(
      await refused(api['debateSuggestions.dismiss']({ params: { id: 'sugg_nothere000000' } })),
    ).toMatchObject({ _tag: 'NotFound' })
    expect(
      await refused(
        api['debateSuggestions.accept']({ params: { id: suggestion!.id }, body: { question: ' ' } }),
      ),
    ).toMatchObject({ _tag: 'Invalid' })
    expect((await succeeded(api['debateSuggestions.list']({}))).suggestions).toHaveLength(1)
  })
})

const started = () => {
  const clock = makeTestClock(NOW)
  return { ...demoApi(VISITOR_ID, createWorld(clock)), clock }
}
