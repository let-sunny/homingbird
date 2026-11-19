import { makeTestClock } from '@homingbird/kernel'
import { describe, expect, it, vi } from 'vitest'
import { later } from '../src/later.ts'

describe('later', () => {
  it('runs the action once its time has passed on the clock', async () => {
    const clock = makeTestClock()
    const action = vi.fn()
    later(clock, 100, action)
    await clock.advance(99)
    expect(action).not.toHaveBeenCalled()
    await clock.advance(1)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('never runs an action cancelled before its time', async () => {
    const clock = makeTestClock()
    const action = vi.fn()
    const cancel = later(clock, 100, action)
    cancel()
    await clock.advance(200)
    expect(action).not.toHaveBeenCalled()
  })
})
