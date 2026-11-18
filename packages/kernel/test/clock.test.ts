import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTestClock, systemClock } from '../src/index.ts'
import { flush, isSettled, trackListeners } from './helpers.ts'

describe('systemClock', () => {
  afterEach(() => vi.useRealTimers())

  it('reads the wall clock', () => {
    vi.useFakeTimers({ now: 1234 })
    expect(systemClock.now()).toBe(1234)
  })

  it('sleeps for the given time and detaches from the signal', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const listeners = trackListeners(controller.signal)
    let done = false
    void systemClock.sleep(100, controller.signal).then(() => {
      done = true
    })
    expect(listeners()).toBe(1)
    await vi.advanceTimersByTimeAsync(99)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
    expect(listeners()).toBe(0)
  })

  it('wakes immediately on abort and clears its timer', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const listeners = trackListeners(controller.signal)
    let done = false
    void systemClock.sleep(100, controller.signal).then(() => {
      done = true
    })
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(listeners()).toBe(0)
  })

  it('does not start a timer for an aborted signal', async () => {
    vi.useFakeTimers()
    await systemClock.sleep(100, AbortSignal.abort())
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('TestClock', () => {
  const live = new AbortController().signal

  it('starts where it is told to', () => {
    expect(makeTestClock().now()).toBe(0)
    expect(makeTestClock(42).now()).toBe(42)
  })

  it('advance moves time even with no sleepers', async () => {
    const clock = makeTestClock(10)
    await clock.advance(5)
    expect(clock.now()).toBe(15)
  })

  it('wakes a sleeper exactly when its time comes', async () => {
    const clock = makeTestClock()
    const sleeping = clock.sleep(100, live)
    expect(clock.pending()).toBe(1)
    await clock.advance(99)
    expect(await isSettled(sleeping)).toBe(false)
    await clock.advance(1)
    expect(await isSettled(sleeping)).toBe(true)
    expect(clock.pending()).toBe(0)
    expect(clock.now()).toBe(100)
  })

  it('wakes sleepers in time order, ties in registration order, at their own time', async () => {
    const clock = makeTestClock()
    const log: Array<[string, number]> = []
    const sleeper = (name: string, ms: number) =>
      clock.sleep(ms, live).then(() => log.push([name, clock.now()]))
    void sleeper('late', 30)
    void sleeper('tie-1', 20)
    void sleeper('early', 10)
    void sleeper('tie-2', 20)
    await clock.advance(50)
    expect(log).toEqual([
      ['early', 10],
      ['tie-1', 20],
      ['tie-2', 20],
      ['late', 30],
    ])
    expect(clock.now()).toBe(50)
  })

  it('wakes sleepers registered by continuations within the same advance', async () => {
    const clock = makeTestClock()
    const log: number[] = []
    void (async () => {
      await clock.sleep(10, live)
      log.push(clock.now())
      await clock.sleep(10, live)
      log.push(clock.now())
      await clock.sleep(10, live)
      log.push(clock.now())
    })()
    await clock.advance(25)
    expect(log).toEqual([10, 20])
    expect(clock.pending()).toBe(1)
    expect(clock.now()).toBe(25)
  })

  it('sees sleepers registered just before advance by pending microtasks', async () => {
    const clock = makeTestClock()
    let woke = false
    void Promise.resolve()
      .then(() => clock.sleep(5, live))
      .then(() => {
        woke = true
      })
    await clock.advance(5)
    expect(woke).toBe(true)
  })

  it('treats negative and zero sleeps as due now, without moving time back', async () => {
    const clock = makeTestClock(100)
    const a = clock.sleep(-50, live)
    const b = clock.sleep(0, live)
    expect(await isSettled(a)).toBe(false)
    await clock.advance(0)
    expect(await isSettled(Promise.all([a, b]))).toBe(true)
    expect(clock.now()).toBe(100)
  })

  it('abort wakes the sleeper, removes it and detaches the listener', async () => {
    const clock = makeTestClock()
    const controller = new AbortController()
    const listeners = trackListeners(controller.signal)
    const sleeping = clock.sleep(100, controller.signal)
    expect(listeners()).toBe(1)
    controller.abort()
    expect(await isSettled(sleeping)).toBe(true)
    expect(clock.pending()).toBe(0)
    expect(listeners()).toBe(0)
    expect(clock.now()).toBe(0)
  })

  it('a normal wake detaches the listener', async () => {
    const clock = makeTestClock()
    const controller = new AbortController()
    const listeners = trackListeners(controller.signal)
    void clock.sleep(1, controller.signal)
    await clock.advance(1)
    expect(listeners()).toBe(0)
  })

  it('an aborted signal never registers a sleeper', async () => {
    const clock = makeTestClock()
    await clock.sleep(100, AbortSignal.abort())
    expect(clock.pending()).toBe(0)
  })

  it('flush runs continuations without moving time', async () => {
    const clock = makeTestClock()
    let ran = false
    void Promise.resolve().then(() => {
      ran = true
    })
    await clock.flush()
    expect(ran).toBe(true)
    expect(clock.now()).toBe(0)
    await flush()
  })
})
