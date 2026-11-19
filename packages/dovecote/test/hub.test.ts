import type { MemberId, StreamEvent } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { makeHub } from '../src/events/hub.ts'

const ana = 'mem_ana' as MemberId
const ben = 'mem_ben' as MemberId

const event = (seq: number): StreamEvent => ({
  seq,
  at: 0,
  body: { type: 'directory.changed', memberId: ana },
})

const nextOf = async (subscription: AsyncIterable<StreamEvent>): Promise<StreamEvent> => {
  const step = await subscription[Symbol.asyncIterator]().next()
  return step.value as StreamEvent
}

describe('the hub', () => {
  it('delivers a member’s events to each of their open streams only', async () => {
    const hub = makeHub(() => 0)
    const open = new AbortController()
    const first = hub.subscribe(ana, 'human', open.signal)
    const second = hub.subscribe(ana, 'agent', open.signal)
    const other = hub.subscribe(ben, 'human', open.signal)
    hub.publish(ana, event(1))
    expect(await nextOf(first)).toEqual(event(1))
    expect(await nextOf(second)).toEqual(event(1))
    hub.broadcast(event(2))
    expect((await nextOf(other)).seq).toBe(2)
    open.abort()
  })

  it('shows a person and their agent online while a stream of that kind is open, never a hidden one', () => {
    const hub = makeHub(() => 0)
    const human = new AbortController()
    const hidden = new AbortController()
    hub.subscribe(ana, 'hidden', hidden.signal)
    expect(hub.presenceOf(ana)).toEqual({ humanOnline: false, agentOnline: false })
    hub.subscribe(ana, 'human', human.signal)
    expect(hub.presenceOf(ana)).toEqual({ humanOnline: true, agentOnline: false })
    human.abort()
    expect(hub.presenceOf(ana)).toEqual({ humanOnline: false, agentOnline: false })
    hidden.abort()
  })

  it('announces presence changes together on the next flush, to every open stream', async () => {
    const hub = makeHub(() => 5)
    const open = new AbortController()
    const watcher = hub.subscribe(ben, 'hidden', open.signal)
    hub.flushPresence()
    hub.subscribe(ana, 'agent', open.signal)
    hub.flushPresence()
    expect(await nextOf(watcher)).toEqual({
      seq: 0,
      at: 5,
      body: { type: 'presence', members: [{ memberId: ana, humanOnline: false, agentOnline: true }] },
    })
    open.abort()
  })

  it('counts a page as looked at until its report runs out or it says it is hidden', () => {
    let now = 0
    const hub = makeHub(() => now)
    hub.reportVisibility(ana, 'cred:inbox', true)
    expect(hub.isLooking(ana)).toBe(true)
    now = 89_999
    expect(hub.isLooking(ana)).toBe(true)
    now = 90_000
    expect(hub.isLooking(ana)).toBe(false)
    hub.reportVisibility(ana, 'cred:inbox', true)
    hub.reportVisibility(ana, 'cred:inbox', false)
    expect(hub.isLooking(ana)).toBe(false)
    expect(hub.isLooking(ben)).toBe(false)
  })

  it('closes a stream when its reader stops, and remembers when the server started', async () => {
    const hub = makeHub(() => 42)
    expect(hub.startedAt).toBe(42)
    const open = new AbortController()
    const subscription = hub.subscribe(ana, 'agent', open.signal)
    await subscription[Symbol.asyncIterator]().return?.()
    expect(hub.presenceOf(ana).agentOnline).toBe(false)
    subscription.close()
    expect(subscription.overflowed()).toBe(false)
  })
})
