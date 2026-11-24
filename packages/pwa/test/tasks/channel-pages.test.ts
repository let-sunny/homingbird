import { Forbidden, type MemberId, NotFound, Unavailable } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import { describe, expect, it } from 'vitest'
import {
  againChannelPage,
  invalidateChannelPage,
  openChannelPage,
  rereadChannelPage,
} from '../../src/tasks/channel-pages.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import { member } from '../support/fixtures.ts'

const agent = {
  agent: member('mem_agent0000000' as MemberId, 'Payments wiki'),
  channel: 'payments-wiki',
  credentials: [],
} as never

const figures = {
  generatedAt: 1,
  channel: 'payments-wiki',
  quickApprovalSeconds: 3,
  minimumGroupSize: 5,
  waiting: 0,
  periods: [],
} as never

const decisions = { channel: 'payments-wiki', days: 30, decisions: [] } as never

describe('what a channel agent’s page asks for', () => {
  it('asks for nothing that no page holds', async () => {
    const { run, routes } = testApp({ 'channels.agent.get': () => agent })
    await run(openChannelPage('channelAgents', 'payments-wiki'))
    await run(invalidateChannelPage('channelAgents', 'payments-wiki'))
    await run(rereadChannelPage('channelAgents', 'payments-wiki'))
    await run(againChannelPage('channelAgents', 'payments-wiki'))
    expect(routes()).toEqual([])
  })

  it('reads the agent, and takes a channel without one for an answer, not for something unread', async () => {
    const found = testApp({ 'channels.agent.get': () => agent })
    const held = found.state.channelAgents.use('payments-wiki', lifetime())
    expect(held.load.get().loaded).toBe(false)
    await found.run(openChannelPage('channelAgents', 'payments-wiki'))
    expect(held.get()).toEqual(agent)
    const gone = testApp({
      'channels.agent.get': () => fail(NotFound({ message: 'This channel has no agent.' })),
    })
    const none = gone.state.channelAgents.use('payments-wiki', lifetime())
    await gone.run(openChannelPage('channelAgents', 'payments-wiki'))
    expect(none.get()).toBeNull()
    expect(none.load.get()).toMatchObject({ loaded: true, step: 'idle' })
  })

  it('reads how the agent is doing and what was decided, nothing for anyone who does not manage the channel', async () => {
    const found = testApp({
      'channels.agent.figures': () => figures,
      'channels.agent.decisions': () => decisions,
    })
    const report = found.state.channelAgentFigures.use('payments-wiki', lifetime())
    const decided = found.state.channelDecisions.use('payments-wiki', lifetime())
    await found.run(openChannelPage('channelAgentFigures', 'payments-wiki'))
    await found.run(openChannelPage('channelDecisions', 'payments-wiki'))
    expect([report.get(), decided.get()]).toEqual([figures, decisions])
    const hidden = testApp({
      'channels.agent.figures': () => fail(NotFound({ message: 'Only managers.' })),
      'channels.agent.decisions': () => fail(NotFound({ message: 'Only managers.' })),
    })
    const noReport = hidden.state.channelAgentFigures.use('payments-wiki', lifetime())
    const noDecisions = hidden.state.channelDecisions.use('payments-wiki', lifetime())
    await hidden.run(openChannelPage('channelAgentFigures', 'payments-wiki'))
    await hidden.run(openChannelPage('channelDecisions', 'payments-wiki'))
    for (const held of [noReport, noDecisions])
      expect([held.get(), held.load.get().loaded]).toEqual([null, true])
  })

  it('tells a refusal in the page’s own place and never as a pop-up, and shows nothing the person may no longer read', async () => {
    let isRefused = false
    const { run, state } = testApp({
      'channels.agent.decisions': () => (isRefused ? fail(Forbidden({ message: 'No.' })) : decisions),
    })
    const held = state.channelDecisions.use('payments-wiki', lifetime())
    await run(openChannelPage('channelDecisions', 'payments-wiki'))
    isRefused = true
    await run(rereadChannelPage('channelDecisions', 'payments-wiki'))
    expect(held.get()).toBeNull()
    expect(held.load.get()).toMatchObject({ loaded: false, step: 'failed' })
    expect(state.notice.get()).toBeNull()
  })

  it('keeps what is shown when the server is only away, and asks afresh on try again', async () => {
    let isAway = false
    const { run, state, routes } = testApp({
      'channels.agent.teaching.get': () =>
        isAway ? fail(Unavailable({ message: 'down' })) : ({ channel: 'payments-wiki' } as never),
    })
    const held = state.channelTeaching.use('payments-wiki', lifetime())
    await run(openChannelPage('channelTeaching', 'payments-wiki'))
    isAway = true
    await run(rereadChannelPage('channelTeaching', 'payments-wiki'))
    expect(held.get()).toEqual({ channel: 'payments-wiki' })
    isAway = false
    await run(againChannelPage('channelTeaching', 'payments-wiki'))
    await settle()
    expect(routes()).toHaveLength(3)
  })

  it('asks once more after the running request, however often it changed meanwhile', async () => {
    const waiting = hold<unknown>()
    let asks = 0
    const { run, state, routes } = testApp({
      'channels.agent.decisions': () => (asks++ === 0 ? waiting.waiting : decisions),
    })
    state.channelDecisions.use('payments-wiki', lifetime())
    void run(openChannelPage('channelDecisions', 'payments-wiki'))
    await settle()
    await run(invalidateChannelPage('channelDecisions', 'payments-wiki'))
    await run(invalidateChannelPage('channelDecisions', 'payments-wiki'))
    expect(routes()).toHaveLength(1)
    waiting.release(decisions)
    await settle()
    await settle()
    expect(routes()).toHaveLength(2)
  })
})
