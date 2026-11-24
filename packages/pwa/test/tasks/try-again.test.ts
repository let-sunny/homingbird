import type { AsRead } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import { describe, expect, it } from 'vitest'
import { TOO_LONG_LOAD_SECONDS } from '../../src/load-timing.ts'
import { openChannelPage } from '../../src/tasks/channel-pages.ts'
import { open } from '../../src/tasks/resources.ts'
import { againWhatFailed, againWhatIsStuck } from '../../src/tasks/try-again.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import { channel, everything, me } from '../support/fixtures.ts'

const refused = () => fail({ _tag: 'Forbidden', message: 'no' })

const start = (handlers: Parameters<typeof testApp>[0]) => {
  const test = testApp({ 'conversations.list': () => ({ conversations: [] }), ...handlers })
  test.state.session.set(me())
  test.state.serverInfo.set(everything())
  const asked = (...routes: ReadonlyArray<string>) =>
    routes.map((route) => test.routes().filter((one) => one === route).length)
  return { ...test, asked }
}

describe('trying again', () => {
  it('asks for the lists that failed or take too long, and after the network is back for those that failed', async () => {
    const slow = hold<unknown>()
    const { app, run, clock, asked, state } = start({
      'directory.list': refused,
      'channels.list': () => slow.waiting,
    })
    app.launch(open('conversations', 'directory', 'channels'))
    await clock.advance(TOO_LONG_LOAD_SECONDS * 1000)
    expect(state.channels.load.get().step).toBe('long')
    const lists = ['conversations.list', 'directory.list', 'channels.list']
    await run(againWhatFailed)
    await settle()
    expect(asked(...lists)).toEqual([1, 2, 1])
    await run(againWhatIsStuck)
    await settle()
    expect(asked(...lists)).toEqual([1, 3, 2])
    app.endSession()
  })

  it('asks for the parts of a channel agent’s page that failed, where a page holds them and the person may see them', async () => {
    const { run, asked, state } = start({
      'channels.list': () => ({
        channels: [channel('billing', { runsAgent: true }), channel('ops', { runsAgent: true })],
        hasMore: false,
        cursor: null,
      }),
      'channels.agent.get': refused,
      'channels.agent.figures': refused,
      'channels.agent.decisions': () => ({ decisions: [] }),
    })
    await run(open('channels'))
    state.channelAgents.use('billing', lifetime())
    state.channelAgents.use('ops', lifetime())
    state.channelAgentFigures.use('billing', lifetime())
    state.channelDecisions.use('billing', lifetime())
    for (const slug of ['billing', 'ops']) await run(openChannelPage('channelAgents', slug))
    await run(openChannelPage('channelAgentFigures', 'billing'))
    await run(openChannelPage('channelDecisions', 'billing'))
    const parts = ['channels.agent.get', 'channels.agent.figures', 'channels.agent.decisions']
    expect(asked(...parts)).toEqual([2, 1, 1])
    await run(againWhatFailed)
    await settle()
    expect(asked(...parts)).toEqual([4, 2, 1])
    state.channels.update((all: ReadonlyArray<AsRead.Channel>) => all.filter((one) => one.slug === 'billing'))
    await run(againWhatIsStuck)
    await settle()
    expect(asked(...parts)).toEqual([5, 3, 1])
  })
})
