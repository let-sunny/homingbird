import { describe, expect, it } from 'vitest'
import { LIMITS, makeRateLimiter } from '../src/http/rate-limiter.ts'

describe('the rate limiter', () => {
  it('allows up to the limit in a window and opens a new window when it ends', () => {
    let now = 0
    const limiter = makeRateLimiter(() => now)
    const limit = { max: 2, windowMs: 1_000 }
    expect([limiter.allow('a', limit), limiter.allow('a', limit), limiter.allow('a', limit)]).toEqual([
      true,
      true,
      false,
    ])
    expect(limiter.allow('b', limit)).toBe(true)
    now = 999
    expect(limiter.allow('a', limit)).toBe(false)
    now = 1_000
    expect(limiter.allow('a', limit)).toBe(true)
  })

  it('forgets old windows once it tracks many keys, and still counts the recent ones', () => {
    let now = 0
    const limiter = makeRateLimiter(() => now)
    const limit = { max: 1, windowMs: 3_600_000 }
    for (let index = 0; index <= 50_000; index++) limiter.allow(`old ${index}`, limit)
    now = 3_600_000
    limiter.allow('recent', limit)
    expect(limiter.allow('recent', limit)).toBe(false)
    expect(limiter.allow('old 1', limit)).toBe(true)
  })

  it('holds a person to a sign-in limit and an agent to a drafting limit per minute', () => {
    expect(LIMITS.signIn.windowMs).toBe(60_000)
    expect(LIMITS.drafting).toEqual({ max: 120, windowMs: 60_000 })
  })
})
