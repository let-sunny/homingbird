import { describe, expect, it } from 'vitest'
import { withApp } from '../../src/app.ts'
import { TOO_LONG_LOAD_SECONDS } from '../../src/load-timing.ts'
import { loadingList } from '../../src/tasks/list-load.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import { channel } from '../support/fixtures.ts'

const TOO_LONG_MS = TOO_LONG_LOAD_SECONDS * 1000

describe('loadingList', () => {
  it('waits as usual, says too long after the limit, and carries on when the answer comes', async () => {
    const answer = hold<unknown>()
    const { run, state, clock } = testApp({ 'channels.list': () => answer.waiting })
    const running = run(awaited)
    await clock.advance(TOO_LONG_MS - 1)
    expect(state.listLoads.channels.step.get()).toBe('loading')
    await clock.advance(1)
    expect(state.listLoads.channels.step.get()).toBe('long')
    answer.release({ channels: [channel('billing')] })
    expect(await running).toMatchObject({ _tag: 'Ok', value: { channels: [{ slug: 'billing' }] } })
  })

  it('tells a failure of a list still waited for once, in its place, and none to its caller', async () => {
    const { run, state } = testApp({ 'channels.list': () => fail({ _tag: 'Unavailable', message: 'down' }) })
    expect(await run(awaited)).toMatchObject({ _tag: 'Err', error: { _tag: 'Interrupt' } })
    expect(state.listLoads.channels.step.get()).toBe('failed')
  })

  it('reports a failure to its caller once the list has come, or when the session ended', async () => {
    const down = testApp({ 'channels.list': () => fail({ _tag: 'Unavailable', message: 'down' }) })
    expect(await down.run(shown)).toMatchObject({
      error: { _tag: 'Fail', error: { _tag: 'Unavailable' } },
    })
    const out = testApp({ 'channels.list': () => fail({ _tag: 'Unauthorized', message: 'out' }) })
    expect(await out.run(awaited)).toMatchObject({
      error: { _tag: 'Fail', error: { _tag: 'Unauthorized' } },
    })
  })

  it('ends a load that a newer one of the same list replaces, so Try again never leaves two', async () => {
    const first = hold<unknown>()
    let calls = 0
    const { run, state, aborted, routes } = testApp({
      'channels.list': () => (calls++ === 0 ? first.waiting : { channels: [] }),
    })
    const older = run(awaited)
    await settle()
    state.listLoads.channels.step.set('long')
    const newer = run(awaited)
    expect((await newer)._tag).toBe('Ok')
    expect(await older).toMatchObject({ _tag: 'Err', error: { _tag: 'Interrupt' } })
    expect(aborted).toEqual(['channels.list'])
    expect(routes()).toEqual(['channels.list', 'channels.list'])
    expect(state.listLoads.channels.step.get()).toBe('loading')
  })
})

const channelsAnswer = withApp(({ api }) => api['channels.list']({ query: {} }))

const awaited = loadingList('channels', true, channelsAnswer)

const shown = loadingList('channels', false, channelsAnswer)
