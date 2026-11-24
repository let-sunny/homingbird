import { type AsRead, Unavailable } from '@homingbird/protocol'
import { lifetime } from '@homingbird/ui'
import { describe, expect, it } from 'vitest'
import { openChannelPage } from '../../src/tasks/channel-pages.ts'
import {
  changeChannelPrinciple,
  deleteChannelPrinciple,
  loadChannelTeaching,
  reorderChannelPrinciples,
  saveChannelInstruction,
  saveChannelPrinciple,
} from '../../src/tasks/channel-teaching.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import { principle } from '../support/fixtures.ts'

const teaching = (instruction = '') =>
  ({ channel: 'billing', instruction, sources: [], updatedAt: null, principles: [], limit: 50 }) as never

describe('channel teaching tasks', () => {
  it('loads what the managers taught the agent where its page is open, and asks for nothing where none is', async () => {
    const loaded = testApp({ 'channels.agent.teaching.get': () => teaching('Be brief.') })
    await loaded.run(loadChannelTeaching('billing'))
    expect(loaded.routes()).toEqual([])
    const held = loaded.state.channelTeaching.use('billing', lifetime())
    await loaded.run(loadChannelTeaching('billing'))
    expect(held.get()).toEqual(teaching('Be brief.'))
  })

  it('keeps what a page shows when only reading it again fails for a moment, and says nothing', async () => {
    let isAway = false
    const { run, state } = testApp({
      'channels.agent.teaching.get': () =>
        isAway ? fail(Unavailable({ message: 'down' })) : teaching('Be brief.'),
    })
    const held = state.channelTeaching.use('billing', lifetime())
    await run(loadChannelTeaching('billing'))
    isAway = true
    await run(loadChannelTeaching('billing'))
    expect(held.get()).toEqual(teaching('Be brief.'))
    expect(state.notice.get()).toBeNull()
  })

  it('saves the instruction, and saves, changes, orders and deletes principles, then shows them again', async () => {
    const { run, sent, state } = testApp({
      'channels.agent.teaching.get': () => teaching(),
      'channels.agent.teaching.set': () => teaching('Saved.'),
      'channels.agent.principles.reorder': () => teaching('Ordered.'),
    })
    const held = state.channelTeaching.use('billing', lifetime())
    await run(saveChannelInstruction('billing', 'Too early.', []))
    expect(held.get()).toBeNull()
    sent.length = 0
    held.set(teaching())
    await run(saveChannelInstruction('billing', 'Saved.', ['https://wiki.example/a']))
    expect(held.get()).toEqual(teaching('Saved.'))
    await run(
      saveChannelPrinciple('billing', {
        topic: 'Refunds',
        rule: 'link it',
        source: null,
        taughtFrom: 'edit',
      }),
    )
    await run(changeChannelPrinciple('billing', 'p1', { enabled: false }))
    await run(reorderChannelPrinciples('billing', ['p2', 'p1']))
    expect(held.get()).toEqual(teaching())
    await run(deleteChannelPrinciple('billing', 'p1'))
    expect(sent.map((one) => [one.route, one.request])).toEqual([
      [
        'channels.agent.teaching.set',
        { params: { slug: 'billing' }, body: { instruction: 'Saved.', sources: ['https://wiki.example/a'] } },
      ],
      [
        'channels.agent.principles.create',
        {
          params: { slug: 'billing' },
          body: { topic: 'Refunds', rule: 'link it', source: null, taughtFrom: 'edit' },
        },
      ],
      ['channels.agent.teaching.get', { params: { slug: 'billing' } }],
      [
        'channels.agent.principles.update',
        { params: { slug: 'billing', id: 'p1' }, body: { enabled: false } },
      ],
      ['channels.agent.teaching.get', { params: { slug: 'billing' } }],
      ['channels.agent.principles.reorder', { params: { slug: 'billing' }, body: { ids: ['p2', 'p1'] } }],
      ['channels.agent.principles.delete', { params: { slug: 'billing', id: 'p1' } }],
      ['channels.agent.teaching.get', { params: { slug: 'billing' } }],
    ])
  })

  it('keeps the instruction and the order on an answer on its way, and whatever else that answer changed', async () => {
    const newer = hold<unknown>()
    const [one, two] = [principle('One'), principle('Two')]
    const taught = (instruction: string, principles: ReadonlyArray<AsRead.Principle>) =>
      ({ channel: 'billing', instruction, sources: [], updatedAt: null, principles, limit: 50 }) as never
    const { app, run, state } = testApp({
      'channels.agent.teaching.get': () => newer.waiting,
      'channels.agent.teaching.set': () => taught('Saved.', [one, two]),
      'channels.agent.principles.reorder': () => taught('', [two, one]),
    })
    const held = state.channelTeaching.use('billing', lifetime())
    held.set(taught('', [one, two]))
    app.launch(openChannelPage('channelTeaching', 'billing'))
    await settle()
    await run(saveChannelInstruction('billing', 'Saved.', []))
    await run(reorderChannelPrinciples('billing', [two.id, one.id]))
    newer.release(taught('Older.', [one, two, principle('Three')]))
    await settle()
    expect(held.get()!.instruction).toBe('Saved.')
    expect(held.get()!.principles.map((each) => each.topic)).toEqual(['Two', 'One', 'Three'])
  })
})
