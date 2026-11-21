import { describe, expect, it } from 'vitest'
import { isUsageLimitNotice, unavailabilityIn } from '../src/agent-availability.ts'

const NOW = new Date(2026, 10, 21, 10, 0).getTime()

const failed = (errors: string, output = '') => unavailabilityIn({ exitCode: 1, output, errors }, NOW)

describe('unavailabilityIn', () => {
  it('reads Claude Code’s usage limit and the reset time after its bar, in seconds or milliseconds', () => {
    expect(failed('Claude AI usage limit reached|1700003600')).toEqual({
      kind: 'usage_limit',
      until: 1_700_003_600_000,
    })
    expect(failed('Claude AI usage limit reached|1700003600123')).toEqual({
      kind: 'usage_limit',
      until: 1_700_003_600_123,
    })
  })

  it('reads a reset time of day as the next such moment on the desk’s own clock', () => {
    expect(failed('5-hour limit reached ∙ resets 3pm')).toEqual({
      kind: 'usage_limit',
      until: new Date(2026, 10, 21, 15, 0).getTime(),
    })
    expect(failed('You’ve hit your limit · resets 9:30am')).toEqual({
      kind: 'usage_limit',
      until: new Date(2026, 10, 22, 9, 30).getTime(),
    })
    expect(failed('usage limit reached, resets at 17:05')?.until).toBe(
      new Date(2026, 10, 21, 17, 5).getTime(),
    )
    expect(failed('usage limit, resets 12am')?.until).toBe(new Date(2026, 10, 22, 0, 0).getTime())
    expect(failed('usage limit, resets 25:00')?.until).toBeNull()
  })

  it('reads Codex’s usage limit and how long until it lifts', () => {
    expect(failed("You've hit your usage limit. Try again in 2 hours 5 minutes.")).toEqual({
      kind: 'usage_limit',
      until: NOW + 125 * 60_000,
    })
    expect(failed("You've hit your usage limit. Try again in 40 min.")?.until).toBe(NOW + 40 * 60_000)
    expect(failed("You've hit your usage limit.")?.until).toBeNull()
  })

  it('counts rate limits, quotas and an empty credit balance as a usage limit with no known end', () => {
    for (const said of [
      'Error: 429 Too Many Requests',
      'rate_limit_error: slow down',
      'insufficient_quota',
      'Credit balance is too low',
    ])
      expect(failed(said)).toEqual({ kind: 'usage_limit', until: null })
  })

  it('reads being signed out from what each agent program says, and in what it printed', () => {
    for (const said of [
      'Invalid API key · Please run /login',
      'Error: Not logged in',
      'not signed in',
      'authentication_error: OAuth token has expired',
      'HTTP 401 Unauthorized',
    ])
      expect(failed(said)).toEqual({ kind: 'signed_out', until: null })
    expect(failed('', 'Please login first')).toEqual({ kind: 'signed_out', until: null })
  })

  it('says nothing about a failure it does not recognize', () => {
    expect(failed('Error: ENOENT')).toBeNull()
    expect(unavailabilityIn({ exitCode: 1, output: '' }, NOW)).toBeNull()
  })
})

describe('isUsageLimitNotice', () => {
  it('recognizes a usage-limit notice printed in place of an answer, and nothing longer or different', () => {
    expect(isUsageLimitNotice('Claude AI usage limit reached|1700003600\n')).toBe(true)
    expect(isUsageLimitNotice("You've hit your usage limit. Try again in 2 hours.")).toBe(true)
    expect(isUsageLimitNotice('5-hour limit reached ∙ resets 3pm')).toBe(true)
    expect(isUsageLimitNotice('Our usage limit for the API is 100 requests a minute.')).toBe(false)
    expect(isUsageLimitNotice(`You've hit your usage limit. ${'x'.repeat(400)}`)).toBe(false)
  })
})
