import { describe, expect, it } from 'vitest'
import { withApp } from '../../src/app.ts'
import { TOO_LONG_LOAD_SECONDS } from '../../src/load-timing.ts'
import { loadDebateList } from '../../src/tasks/debates.ts'
import { loadingList } from '../../src/tasks/list-load.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import { summary } from '../support/fixtures.ts'

const TOO_LONG_MS = TOO_LONG_LOAD_SECONDS * 1000

describe('loadingList', () => {
  it('waits as usual, says too long after the limit, and carries on when the answer comes', async () => {
    const answer = hold<unknown>()
    const { run, state, clock } = testApp({ 'debates.list': () => answer.waiting })
    const running = run(loadDebateList)
    await clock.advance(TOO_LONG_MS - 1)
    expect(state.listLoads.flocks.step.get()).toBe('loading')
    await clock.advance(1)
    expect(state.listLoads.flocks.step.get()).toBe('long')
    answer.release({ debates: [summary()] })
    expect((await running)._tag).toBe('Ok')
    expect(state.debatesLoaded.get()).toBe(true)
    expect(state.debates.get()).toHaveLength(1)
  })

  it('says it failed and still reports the refusal to its caller', async () => {
    const { run, state } = testApp({ 'debates.list': () => fail({ _tag: 'Unavailable', message: 'down' }) })
    const exit = await run(loadDebateList)
    expect(exit._tag).toBe('Err')
    expect(state.listLoads.flocks.step.get()).toBe('failed')
    expect(state.debatesLoaded.get()).toBe(false)
  })

  it('ends a load that a newer one of the same list replaces, so Try again never leaves two', async () => {
    const first = hold<unknown>()
    let calls = 0
    const { run, state, aborted, routes } = testApp({
      'debates.list': () => (calls++ === 0 ? first.waiting : { debates: [] }),
    })
    const older = run(loadDebateList)
    await settle()
    state.listLoads.flocks.step.set('long')
    const newer = run(loadDebateList)
    expect((await newer)._tag).toBe('Ok')
    expect(await older).toMatchObject({ _tag: 'Err', error: { _tag: 'Interrupt' } })
    expect(aborted).toEqual(['debates.list'])
    expect(routes()).toEqual(['debates.list', 'debates.list'])
    expect(state.listLoads.flocks.step.get()).toBe('loading')
    expect(state.debatesLoaded.get()).toBe(true)
  })

  it('keeps one list’s load apart from another’s', async () => {
    const answer = hold<unknown>()
    const { run, state } = testApp({ 'channels.list': () => answer.waiting })
    const running = run(loadingList('channels', channelsAnswer))
    await settle()
    state.listLoads.flocks.step.set('failed')
    expect(state.listLoads.channels.step.get()).toBe('loading')
    answer.release({ channels: [] })
    await running
  })
})

const channelsAnswer = withApp(({ api }) => api['channels.list']({ query: {} }))
