import { DEFAULT_SCHEDULING_DELEGATION } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/scheduling.ts'
import { testApp } from '../support/app.ts'
import { debate } from '../support/fixtures.ts'

const ID = 'debate_000000000000' as never
const VIEW = { delegation: DEFAULT_SCHEDULING_DELEGATION, agentInUse: null }

describe('scheduling tasks', () => {
  it('reads and saves how the person’s agent schedules for them', async () => {
    const { run, sent } = testApp({ 'me.scheduling.get': () => VIEW, 'me.scheduling.set': () => VIEW })
    await run(tasks.loadSchedulingDelegation)
    await run(tasks.saveSchedulingDelegation(DEFAULT_SCHEDULING_DELEGATION))
    expect(sent.map((one) => [one.route, one.request])).toEqual([
      ['me.scheduling.get', {}],
      ['me.scheduling.set', { body: DEFAULT_SCHEDULING_DELEGATION }],
    ])
  })

  it('opens a room again, in the same window or the one given, and reloads the list', async () => {
    const { run, sent } = testApp({
      'scheduling.retry': () => debate(),
      'debates.list': () => ({ debates: [] }),
    })
    const window = { startsAt: 1, endsAt: 2 }
    await run(tasks.retrySchedulingRoom(ID, null))
    await run(tasks.retrySchedulingRoom(ID, window))
    expect(sent.map((one) => [one.route, one.request])).toEqual([
      ['scheduling.retry', { params: { id: ID }, body: {} }],
      ['debates.list', {}],
      ['scheduling.retry', { params: { id: ID }, body: { window } }],
      ['debates.list', {}],
    ])
  })
})
