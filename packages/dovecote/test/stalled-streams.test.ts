import { EventEmitter } from 'node:events'
import { Task as T, makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import {
  MISSED_PONGS_BEFORE_CLOSING,
  STREAM_DRAIN_TIMEOUT_MS,
  pongWatch,
  writeDrained,
} from '../src/http/stalled-streams.ts'

const reader = (accepts: boolean) => {
  const emitter = new EventEmitter()
  return Object.assign(emitter, { write: (_chunk: string | Uint8Array) => accepts })
}

describe('a stream whose reader stalls', () => {
  it('goes on at once while the reader keeps up', async () => {
    expect(await T.runPromise(writeDrained(reader(true), 'x'), { clock: makeTestClock(0) })).toBe(true)
  })

  it('goes on once the reader drains, and leaves no listener behind', async () => {
    const clock = makeTestClock(0)
    const slow = reader(false)
    const written = T.runPromise(writeDrained(slow, 'x'), { clock })
    await clock.advance(STREAM_DRAIN_TIMEOUT_MS - 1)
    slow.emit('drain')
    expect(await written).toBe(true)
    expect(slow.listenerCount('drain')).toBe(0)
  })

  it('is given up when the reader does not drain within a minute', async () => {
    const clock = makeTestClock(0)
    const stalled = reader(false)
    const written = T.runPromise(writeDrained(stalled, 'x'), { clock })
    await clock.advance(STREAM_DRAIN_TIMEOUT_MS)
    expect(await written).toBe(false)
    expect(stalled.listenerCount('drain')).toBe(0)
    expect(STREAM_DRAIN_TIMEOUT_MS).toBe(60_000)
  })

  it('stops waiting, and leaves no listener behind, when the connection ends', async () => {
    const ended = new AbortController()
    const stalled = reader(false)
    const written = T.run(writeDrained(stalled, 'x'), { clock: makeTestClock(0) }, ended.signal)
    ended.abort()
    expect((await written)._tag).toBe('Err')
    expect(stalled.listenerCount('drain')).toBe(0)
  })
})

describe('a WebSocket that stops answering pings', () => {
  it('is stalled once two pings in a row went unanswered, and a pong clears the count', () => {
    const watch = pongWatch()
    watch.pinged()
    expect(watch.isStalled()).toBe(false)
    watch.ponged()
    watch.pinged()
    watch.pinged()
    expect(watch.isStalled()).toBe(true)
    expect(MISSED_PONGS_BEFORE_CLOSING).toBe(2)
  })
})
