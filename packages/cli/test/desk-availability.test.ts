import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  FAILURES_BEFORE_UNABLE,
  RETRY_UNAVAILABLE_MS,
  isNewlyUnavailable,
  isRetryDue,
  mayTryNow,
  unavailableAfterFailure,
  unavailableLine,
} from '../src/desk-availability.ts'

describe('the desk’s availability', () => {
  it('becomes "failing" only once several runs failed in a row, and at once when the agent said why', () => {
    expect(unavailableAfterFailure(null, null, FAILURES_BEFORE_UNABLE - 1, 5)).toBeNull()
    expect(unavailableAfterFailure(null, null, FAILURES_BEFORE_UNABLE, 5)).toEqual({
      kind: 'failed',
      until: null,
      triedAt: 5,
    })
    expect(unavailableAfterFailure(null, { kind: 'signed_out', until: null }, 1, 5)).toEqual({
      kind: 'signed_out',
      until: null,
      triedAt: 5,
    })
  })

  it('keeps its kind when a retry fails without saying why, and forgets a reset time that passed', () => {
    const limited = { kind: 'usage_limit' as const, until: 100, triedAt: 0 }
    expect(unavailableAfterFailure(limited, null, 1, 120)).toEqual({
      kind: 'usage_limit',
      until: null,
      triedAt: 120,
    })
  })

  it('lets a note be tried at the reset time when one is known, otherwise every 15 minutes', () => {
    expect(mayTryNow(null, 0)).toBe(true)
    expect(mayTryNow({ kind: 'usage_limit', until: 100, triedAt: 0 }, 99)).toBe(false)
    expect(mayTryNow({ kind: 'usage_limit', until: 100, triedAt: 0 }, 100)).toBe(true)
    expect(mayTryNow({ kind: 'failed', until: null, triedAt: 0 }, RETRY_UNAVAILABLE_MS - 1)).toBe(false)
    expect(mayTryNow({ kind: 'failed', until: null, triedAt: 0 }, RETRY_UNAVAILABLE_MS)).toBe(true)
  })

  it('is due for a retry without a note only at a known reset time', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (until, now) => {
        expect(isRetryDue({ kind: 'usage_limit', until, triedAt: 0 }, now)).toBe(now >= until)
        expect(isRetryDue({ kind: 'failed', until: null, triedAt: 0 }, now)).toBe(false)
        expect(isRetryDue(null, now)).toBe(false)
      }),
    )
  })

  it('tells colleagues again only when it starts or its kind or time changes', () => {
    const failing = { kind: 'failed' as const, until: null, triedAt: 0 }
    expect(isNewlyUnavailable(null, failing)).toBe(true)
    expect(isNewlyUnavailable(failing, { ...failing, triedAt: 9 })).toBe(false)
    expect(isNewlyUnavailable(failing, { ...failing, kind: 'signed_out' })).toBe(true)
    expect(isNewlyUnavailable(failing, { ...failing, until: 5 })).toBe(true)
  })

  it('says in one line why, and when it tries again', () => {
    expect(unavailableLine({ kind: 'usage_limit', until: 7, triedAt: 0 }, () => '3:00 PM')).toBe(
      'The agent reached its usage limit. Arriving notes wait as delivered and colleagues see that your agent can’t answer right now; the desk tries again at 3:00 PM.',
    )
    expect(unavailableLine({ kind: 'failed', until: null, triedAt: 0 }, String)).toMatch(
      /^The agent command failed 3 times in a row: .* the desk tries again on the next note, at most every 15 minutes\.$/,
    )
  })
})
