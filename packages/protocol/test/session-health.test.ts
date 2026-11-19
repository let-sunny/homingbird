import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import * as plugin from '../../plugin/hooks/session-thresholds.ts'
import {
  CONTEXT_BUCKETS,
  DeskSession,
  FRESH_SESSION_AFTER_MINUTES,
  FRESH_SESSION_AT_CONTEXT_PERCENT,
  SESSION_AGE_BUCKETS,
  contextBucket,
  needsFreshSession,
  sessionAgeBucket,
} from '../src/session-health.ts'

describe('needsFreshSession', () => {
  it('asks for a fresh session after eight hours or at 80% of the context, and not before', () => {
    expect(needsFreshSession({ ageMinutes: 479, contextPercent: 79 })).toBe(false)
    expect(needsFreshSession({ ageMinutes: 480, contextPercent: null })).toBe(true)
    expect(needsFreshSession({ ageMinutes: 0, contextPercent: 80 })).toBe(true)
    expect(needsFreshSession({ ageMinutes: 0, contextPercent: null })).toBe(false)
  })

  it('uses the same thresholds as the plugin pane', () => {
    expect(plugin.FRESH_SESSION_AFTER_MINUTES).toBe(FRESH_SESSION_AFTER_MINUTES)
    expect(plugin.FRESH_SESSION_AT_CONTEXT_PERCENT).toBe(FRESH_SESSION_AT_CONTEXT_PERCENT)
  })
})

describe('buckets', () => {
  it('puts a session age into the bucket its bounds name', () => {
    expect([0, 59, 60, 239, 240, 719, 720, 10_000].map(sessionAgeBucket)).toEqual([
      'under_hour',
      'under_hour',
      'hours',
      'hours',
      'half_day',
      'half_day',
      'longer',
      'longer',
    ])
  })

  it('puts context use into the bucket its bounds name, and unknown when not reported', () => {
    expect([0, 49, 50, 79, 80, 100, null].map(contextBucket)).toEqual([
      'under_half',
      'under_half',
      'most',
      'most',
      'nearly_full',
      'nearly_full',
      'unknown',
    ])
  })

  it('always gives a listed bucket, and later or fuller never an earlier one', () => {
    fc.assert(
      fc.property(fc.nat(100_000), fc.nat(100_000), (a, b) => {
        const [young, old] = a <= b ? [a, b] : [b, a]
        expect(SESSION_AGE_BUCKETS.indexOf(sessionAgeBucket(young))).toBeLessThanOrEqual(
          SESSION_AGE_BUCKETS.indexOf(sessionAgeBucket(old)),
        )
      }),
    )
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (percent) => {
        expect(CONTEXT_BUCKETS).toContain(contextBucket(percent))
        expect(contextBucket(percent)).not.toBe('unknown')
      }),
    )
  })
})

describe('DeskSession', () => {
  it('takes a whole number of minutes and a percentage, or no percentage', () => {
    expect(DeskSession.decode({ ageMinutes: 95, contextPercent: 62 })._tag).toBe('Ok')
    expect(DeskSession.decode({ ageMinutes: 95 })._tag).toBe('Ok')
    expect(DeskSession.decode({ ageMinutes: -1 })._tag).toBe('Err')
    expect(DeskSession.decode({ ageMinutes: 1, contextPercent: 101 })._tag).toBe('Err')
  })
})
