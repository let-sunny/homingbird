import { describe, expect, it } from 'vitest'
import { DEBATE_GRACE_MINUTES } from '../src/debate-grace.ts'
import { DEFAULT_DEBATE_LIMITS, DEFAULT_GRACE_MINUTES, DebateLimits } from '../src/debates.ts'

describe('the inactivity grace', () => {
  it('offers 5, 10 or 30 minutes, 5 by default, and nothing else', () => {
    expect(DEBATE_GRACE_MINUTES).toEqual([5, 10, 30])
    expect(DEFAULT_GRACE_MINUTES).toBe(5)
    expect(DebateLimits.decode({ ...DEFAULT_DEBATE_LIMITS, graceMinutes: 30 })._tag).toBe('Ok')
    expect(DebateLimits.decode({ ...DEFAULT_DEBATE_LIMITS, graceMinutes: 15 })._tag).toBe('Err')
  })
})
