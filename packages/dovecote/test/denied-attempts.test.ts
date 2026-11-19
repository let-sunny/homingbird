import { describe, expect, it } from 'vitest'
import { ATTEMPT_WINDOW_MS, makeAttemptWindows, truncatedAddress } from '../src/domain/denied-attempts.ts'
import type { Caller } from '../src/environment.ts'

const caller = { credential: { id: 'cred_a00000000000' } } as Caller

describe('refused attempts', () => {
  it('count per key, and come due once their minute is over', () => {
    let now = 0
    const windows = makeAttemptWindows(() => now)
    const denied = { kind: 'denied', caller, route: 'drafts.send', requestId: 'req_1' } as const
    windows.count('a', denied)
    now = 10
    windows.count('a', { ...denied, requestId: 'req_2' })
    now = 30
    windows.count('b', { kind: 'address', clientAddress: '203.0.113.0/24' })
    expect(windows.take(ATTEMPT_WINDOW_MS - 1)).toEqual([])
    expect(windows.take(ATTEMPT_WINDOW_MS)).toEqual([{ attempt: denied, firstAt: 0, count: 2 }])
    expect(windows.take(ATTEMPT_WINDOW_MS + 30).map((window) => window.count)).toEqual([1])
    expect(windows.take(Number.POSITIVE_INFINITY)).toEqual([])
  })

  it('takes every open window at once at shutdown', () => {
    const windows = makeAttemptWindows(() => 5)
    windows.count('a', { kind: 'address', clientAddress: 'x' })
    expect(windows.take(Number.POSITIVE_INFINITY)).toHaveLength(1)
  })

  it('cuts an address to its network before it reaches a log line', () => {
    expect(truncatedAddress('203.0.113.77')).toBe('203.0.113.0/24')
    expect(truncatedAddress('::ffff:198.51.100.9')).toBe('198.51.100.0/24')
    expect(truncatedAddress('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::/48')
    expect(truncatedAddress('2001:db8::1')).toBe('2001:db8:0::/48')
    expect(truncatedAddress('::1')).toBe('0:0:0::/48')
    expect(truncatedAddress('somewhere')).toBe('unknown')
  })
})
