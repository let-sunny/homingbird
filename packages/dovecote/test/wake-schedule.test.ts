import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type WakeFacts,
  afterAttempt,
  afterSilence,
  debateDueAt,
  pendingWake,
  wakeDue,
} from '../src/wake/wake-schedule.ts'

const MINUTE = 60_000
const NOW = 100 * MINUTE

const facts = (overrides: Partial<WakeFacts> = {}): WakeFacts => ({
  now: NOW,
  lastWakeAt: null,
  lastStatus: 'never',
  retryAt: null,
  lastUsedAt: null,
  agentOnline: false,
  waitingSince: NOW - 30_000,
  debateDueAt: null,
  ...overrides,
})

describe('a wake that reached the service', () => {
  it('came online once the credential is used after it, and did not after ten silent minutes', () => {
    const sent = { now: NOW, lastWakeAt: NOW - MINUTE, lastStatus: 'sent' as const, lastUsedAt: null }
    expect(pendingWake(sent)).toBe('waiting')
    expect(pendingWake({ ...sent, lastUsedAt: NOW - MINUTE })).toBe('came_online')
    expect(pendingWake({ ...sent, lastUsedAt: NOW - 2 * MINUTE })).toBe('waiting')
    expect(pendingWake({ ...sent, lastWakeAt: NOW - 10 * MINUTE })).toBe('did_not_come_online')
    expect(pendingWake({ ...sent, lastWakeAt: NOW - 10 * MINUTE + 1 })).toBe('waiting')
  })

  it('waits for nothing when the last attempt was not sent', () => {
    for (const lastStatus of [
      'never',
      'online',
      'refused',
      'not_online',
      'rate_limited',
      'unreachable',
    ] as const)
      expect(pendingWake({ now: NOW, lastWakeAt: NOW - MINUTE, lastStatus, lastUsedAt: null })).toBeNull()
    expect(pendingWake({ now: NOW, lastWakeAt: null, lastStatus: 'sent', lastUsedAt: null })).toBeNull()
  })
})

describe('when a wake is due', () => {
  it('wakes for work after 30 seconds of gathering, not before', () => {
    expect(wakeDue(facts())).toEqual({ work: true, debate: false })
    expect(wakeDue(facts({ waitingSince: NOW - 29_999 })).work).toBe(false)
    expect(wakeDue(facts({ waitingSince: null })).work).toBe(false)
  })

  it('never wakes while a desk is online, the credential was used in the last two minutes, or before a retry', () => {
    expect(wakeDue(facts({ agentOnline: true })).work).toBe(false)
    expect(wakeDue(facts({ lastUsedAt: NOW - 2 * MINUTE + 1 })).work).toBe(false)
    expect(wakeDue(facts({ lastUsedAt: NOW - 2 * MINUTE })).work).toBe(true)
    expect(wakeDue(facts({ retryAt: NOW + 1 })).work).toBe(false)
    expect(wakeDue(facts({ retryAt: NOW })).work).toBe(true)
  })

  it('wakes for work at most every five minutes and for a flock every three', () => {
    expect(wakeDue(facts({ lastWakeAt: NOW - 5 * MINUTE + 1 })).work).toBe(false)
    expect(wakeDue(facts({ lastWakeAt: NOW - 5 * MINUTE })).work).toBe(true)
    const room = { waitingSince: null, debateDueAt: NOW }
    expect(wakeDue(facts({ ...room, lastWakeAt: NOW - 3 * MINUTE + 1 })).debate).toBe(false)
    expect(wakeDue(facts({ ...room, lastWakeAt: NOW - 3 * MINUTE }))).toEqual({ work: false, debate: true })
    expect(wakeDue(facts({ ...room, debateDueAt: NOW + 1 })).debate).toBe(false)
    expect(wakeDue(facts({ ...room, agentOnline: true })).debate).toBe(false)
  })

  it('is never due while an agent of the person is online, whatever else holds', () => {
    const anyFacts = fc.record({
      lastWakeAt: fc.option(fc.integer({ min: 0, max: NOW })),
      retryAt: fc.option(fc.integer({ min: 0, max: 2 * NOW })),
      lastUsedAt: fc.option(fc.integer({ min: 0, max: NOW })),
      waitingSince: fc.option(fc.integer({ min: 0, max: NOW })),
      debateDueAt: fc.option(fc.integer({ min: 0, max: 2 * NOW })),
    })
    fc.assert(
      fc.property(anyFacts, (some) => {
        expect(wakeDue(facts({ ...some, agentOnline: true }))).toEqual({ work: false, debate: false })
      }),
    )
  })

  it('asks for a room two minutes before its grace runs out, counted from the last use or the joining', () => {
    expect(debateDueAt([], NOW)).toBeNull()
    expect(debateDueAt([{ graceMinutes: 10, joinedAt: 0 }], NOW)).toBe(NOW + 8 * MINUTE)
    expect(
      debateDueAt(
        [
          { graceMinutes: 30, joinedAt: 0 },
          { graceMinutes: 5, joinedAt: 0 },
        ],
        NOW,
      ),
    ).toBe(NOW + 3 * MINUTE)
    expect(debateDueAt([{ graceMinutes: 5, joinedAt: NOW }], null)).toBe(NOW + 3 * MINUTE)
  })
})

describe('what an attempt leaves behind', () => {
  it('counts a 2xx and a timeout as sent, keeping the failures', () => {
    expect(afterAttempt({ status: 200, retryAfter: null }, 2, NOW)).toEqual({
      lastStatus: 'sent',
      failures: 2,
      retryAt: null,
      stop: null,
    })
    expect(afterAttempt({ status: 299, retryAfter: null }, 0, NOW).lastStatus).toBe('sent')
    expect(afterAttempt('timeout', 0, NOW).lastStatus).toBe('sent')
  })

  it('stops at once when the service refuses the wake', () => {
    for (const status of [400, 401, 403, 404])
      expect(afterAttempt({ status, retryAfter: null }, 0, NOW)).toEqual({
        lastStatus: 'refused',
        failures: 1,
        retryAt: null,
        stop: 'refused',
      })
  })

  it('waits 5, 15 and then 60 minutes after a server error, a redirect or no answer', () => {
    for (const status of [0, 302, 405, 500, 503])
      expect(afterAttempt({ status, retryAfter: null }, 0, NOW)).toEqual({
        lastStatus: 'unreachable',
        failures: 1,
        retryAt: NOW + 5 * MINUTE,
        stop: null,
      })
    expect(afterAttempt({ status: 503, retryAfter: null }, 1, NOW).retryAt).toBe(NOW + 15 * MINUTE)
    expect(afterAttempt({ status: 503, retryAfter: null }, 2, NOW).retryAt).toBe(NOW + 60 * MINUTE)
    expect(afterAttempt({ status: 503, retryAfter: null }, 3, NOW).retryAt).toBe(NOW + 60 * MINUTE)
  })

  it('follows Retry-After in seconds or as a date, up to an hour', () => {
    const limited = (retryAfter: string | null) => afterAttempt({ status: 429, retryAfter }, 0, NOW)
    expect(limited('120')).toEqual({
      lastStatus: 'rate_limited',
      failures: 1,
      retryAt: NOW + 2 * MINUTE,
      stop: null,
    })
    expect(limited(' 0 ').retryAt).toBe(NOW)
    expect(limited('86400').retryAt).toBe(NOW + 60 * MINUTE)
    expect(limited(new Date(NOW + 7 * MINUTE).toUTCString()).retryAt).toBe(NOW + 7 * MINUTE)
    expect(limited(new Date(NOW - MINUTE).toUTCString()).retryAt).toBe(NOW + 5 * MINUTE)
    expect(limited('soon').retryAt).toBe(NOW + 5 * MINUTE)
    expect(limited(null).retryAt).toBe(NOW + 5 * MINUTE)
  })

  it('stops after five failures in a row, a silent desk among them', () => {
    expect(afterAttempt({ status: 500, retryAfter: null }, 3, NOW).stop).toBeNull()
    expect(afterAttempt({ status: 500, retryAfter: null }, 4, NOW).stop).toBe('failures')
    expect(afterAttempt({ status: 429, retryAfter: '1' }, 4, NOW).stop).toBe('failures')
    expect(afterSilence(0, NOW)).toEqual({
      lastStatus: 'not_online',
      failures: 1,
      retryAt: NOW + 5 * MINUTE,
      stop: null,
    })
    expect(afterSilence(4, NOW).stop).toBe('failures')
  })
})
