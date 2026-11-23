import { DEFAULT_DEBATE_LIMITS } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/debates.ts'
import { fail, testApp } from '../support/app.ts'
import { debate } from '../support/fixtures.ts'

const ID = 'debate_000000000000' as never

describe('flock tasks', () => {
  it('loads the list of flocks and marks it loaded', async () => {
    const { run, state } = testApp({ 'debates.list': () => ({ debates: [] }) })
    await run(tasks.loadDebates)
    expect(state.debatesLoaded.get()).toBe(true)
  })

  it('opens a scheduling flock and reloads the list', async () => {
    const { run, sent } = testApp({
      'scheduling.create': () => debate(),
      'debates.list': () => ({ debates: [] }),
    })
    const setup = {
      title: 'Planning sync',
      minutes: 30,
      window: { startsAt: 1, endsAt: 86_400_000 },
      attendees: [{ memberId: 'mem_ben' as never, required: true }],
    }
    await run(tasks.createSchedulingRoom(setup))
    expect(sent.map((one) => [one.route, one.request])).toEqual([
      ['scheduling.create', { body: setup }],
      ['debates.list', {}],
    ])
  })

  it('gives free times, adds a meeting and takes it out, showing the flock each time', async () => {
    const { run, sent, state } = testApp({
      'scheduling.slots.set': () => debate({ question: 'Slots' }),
      'scheduling.attendance.add': () => debate({ question: 'Added' }),
      'scheduling.attendance.remove': () => debate({ question: 'Removed' }),
    })
    const slots = [{ startsAt: 1, endsAt: 2 }]
    await run(tasks.setMyFreeTimes(ID, slots))
    expect((state.shownDebate.get() as ReturnType<typeof debate>).question).toBe('Slots')
    await run(tasks.addMeeting(ID))
    expect((state.shownDebate.get() as ReturnType<typeof debate>).question).toBe('Added')
    await run(tasks.removeMeeting(ID))
    expect((state.shownDebate.get() as ReturnType<typeof debate>).question).toBe('Removed')
    expect(sent.map((one) => [one.route, one.request])).toEqual([
      ['scheduling.slots.set', { params: { id: ID }, body: { slots } }],
      ['scheduling.attendance.add', { params: { id: ID } }],
      ['scheduling.attendance.remove', { params: { id: ID } }],
    ])
  })

  it('shows a flock, or shows it as missing when the person may not see it', async () => {
    const shown = testApp({ 'debates.get': () => debate() })
    await shown.run(tasks.loadDebate(ID))
    expect(shown.state.shownDebate.get()).toEqual(debate())
    const missing = testApp({ 'debates.get': () => fail({ _tag: 'NotFound', message: 'No such flock.' }) })
    await missing.run(tasks.loadDebate(ID))
    expect(missing.state.shownDebate.get()).toBe('missing')
  })

  it('opens a flock and reloads the list, opts an agent in, changes limits, posts and exports', async () => {
    const { run, sent, state } = testApp({
      'debates.create': () => debate(),
      'debates.list': () => ({ debates: [] }),
      'debates.optIn': () => debate({ question: 'Opted in' }),
      'debates.limits.set': () => debate({ question: 'Changed' }),
      'debates.export': () => ({ filename: 'debate.md', mediaType: 'text/markdown', text: '#' }),
    })
    const wish = {
      question: 'Ship?',
      visibility: 'open' as const,
      limits: DEFAULT_DEBATE_LIMITS,
      memberIds: [],
    }
    await run(tasks.createDebate(wish))
    await run(tasks.optInAgent(ID, 'cred_agent' as never, ''))
    expect((state.shownDebate.get() as ReturnType<typeof debate>).question).toBe('Opted in')
    await run(tasks.changeLimits(ID, DEFAULT_DEBATE_LIMITS))
    await run(tasks.postResult(ID, { channel: 'billing' }))
    expect(await run(tasks.exportDebate(ID, 'markdown', 'ko'))).toMatchObject({
      _tag: 'Ok',
      value: { filename: 'debate.md' },
    })
    expect(sent.map((one) => [one.route, one.request])).toEqual([
      ['debates.create', { body: wish }],
      ['debates.list', {}],
      ['debates.optIn', { params: { id: ID }, body: { agentId: 'cred_agent' } }],
      ['debates.limits.set', { params: { id: ID }, body: DEFAULT_DEBATE_LIMITS }],
      ['debates.result.post', { params: { id: ID }, body: { channel: 'billing' } }],
      ['debates.export', { params: { id: ID }, body: { format: 'markdown', language: 'ko' } }],
    ])
  })

  it('opts an agent in with the person’s note, trimmed, and sets or clears that note', async () => {
    const { run, sent, state } = testApp({
      'debates.optIn': () => debate({ question: 'Opted in' }),
      'debates.brief.set': () => debate({ question: 'Noted' }),
    })
    await run(tasks.optInAgent(ID, 'cred_agent' as never, '  Use the Q3 budget.  '))
    await run(tasks.optInAgent(ID, 'cred_agent' as never, '   '))
    await run(tasks.setBrief(ID, ' Only public figures. '))
    expect((state.shownDebate.get() as ReturnType<typeof debate>).question).toBe('Noted')
    await run(tasks.setBrief(ID, '  '))
    expect(sent.map((one) => [one.route, one.request])).toEqual([
      ['debates.optIn', { params: { id: ID }, body: { agentId: 'cred_agent', brief: 'Use the Q3 budget.' } }],
      ['debates.optIn', { params: { id: ID }, body: { agentId: 'cred_agent' } }],
      ['debates.brief.set', { params: { id: ID }, body: { brief: 'Only public figures.' } }],
      ['debates.brief.set', { params: { id: ID }, body: { brief: '' } }],
    ])
  })
})
