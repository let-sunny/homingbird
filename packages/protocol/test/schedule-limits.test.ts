import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  allowedStretches,
  clippedToLimits,
  hasNoLimits,
  isAllowed,
  isMeetingPossible,
  limitsLines,
  limitsSentence,
  scheduleLimitsProblem,
} from '../src/schedule-limits.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const MONDAY = Date.UTC(2026, 10, 23)

describe('the problem with limits', () => {
  it('finds none in limits that name a real zone, whole quarter hours and each day once', () => {
    expect(scheduleLimitsProblem({})).toBeNull()
    expect(scheduleLimitsProblem({ weekdays: [1, 3], timeZone: 'Asia/Seoul' })).toBeNull()
    expect(scheduleLimitsProblem({ hours: { from: 540, to: 1080 }, timeZone: 'UTC' })).toBeNull()
  })

  it('refuses a zone without limits, limits without a real zone, a repeated day and bad hours', () => {
    expect(scheduleLimitsProblem({ timeZone: 'UTC' })).toMatch(/only goes with/)
    expect(scheduleLimitsProblem({ weekdays: [1] })).toMatch(/need a time zone/)
    expect(scheduleLimitsProblem({ weekdays: [1], timeZone: 'Mars/Olympus' })).toMatch(/need a time zone/)
    expect(scheduleLimitsProblem({ weekdays: [1, 1], timeZone: 'UTC' })).toMatch(/each weekday once/)
    expect(scheduleLimitsProblem({ hours: { from: 545, to: 600 }, timeZone: 'UTC' })).toMatch(/quarter hour/)
    expect(scheduleLimitsProblem({ hours: { from: 600, to: 610 }, timeZone: 'UTC' })).toMatch(/quarter hour/)
    expect(scheduleLimitsProblem({ hours: { from: 600, to: 600 }, timeZone: 'UTC' })).toMatch(
      /after they start/,
    )
  })

  it('reads limits that leave nothing out as none', () => {
    expect(hasNoLimits({})).toBe(true)
    expect(
      hasNoLimits({ weekdays: [1, 2, 3, 4, 5, 6, 7], hours: { from: 0, to: 1440 }, timeZone: 'UTC' }),
    ).toBe(true)
    expect(hasNoLimits({ weekdays: [1], timeZone: 'UTC' })).toBe(false)
    expect(hasNoLimits({ hours: { from: 15, to: 1440 }, timeZone: 'UTC' })).toBe(false)
    expect(hasNoLimits({ hours: { from: 0, to: 1425 }, timeZone: 'UTC' })).toBe(false)
  })
})

describe('the stretches the limits allow', () => {
  const week = { startsAt: MONDAY, endsAt: MONDAY + 7 * DAY }

  it('is the window itself without limits', () => {
    expect(allowedStretches(week, {})).toEqual([week])
    expect(allowedStretches(week, { weekdays: [1, 2, 3, 4, 5, 6, 7], timeZone: 'UTC' })).toEqual([week])
    expect(allowedStretches(week, { weekdays: [1] })).toEqual([week])
  })

  it('cuts each chosen day to the chosen hours, by the clock of the zone', () => {
    const limits = { weekdays: [1, 3], hours: { from: 600, to: 900 }, timeZone: 'UTC' }
    expect(allowedStretches(week, limits)).toEqual([
      { startsAt: MONDAY + 10 * HOUR, endsAt: MONDAY + 15 * HOUR },
      { startsAt: MONDAY + 2 * DAY + 10 * HOUR, endsAt: MONDAY + 2 * DAY + 15 * HOUR },
    ])
    const seoul = { weekdays: [1], hours: { from: 600, to: 900 }, timeZone: 'Asia/Seoul' }
    expect(allowedStretches({ startsAt: MONDAY - DAY, endsAt: MONDAY + 2 * DAY }, seoul)).toEqual([
      { startsAt: MONDAY + HOUR, endsAt: MONDAY + 6 * HOUR },
    ])
  })

  it('joins whole chosen days that touch, and keeps days apart that do not', () => {
    expect(allowedStretches(week, { weekdays: [2, 3, 6], timeZone: 'UTC' })).toEqual([
      { startsAt: MONDAY + DAY, endsAt: MONDAY + 3 * DAY },
      { startsAt: MONDAY + 5 * DAY, endsAt: MONDAY + 6 * DAY },
    ])
  })

  it('stays inside the window, at its start and its end', () => {
    const limits = { hours: { from: 600, to: 900 }, timeZone: 'UTC' }
    const window = { startsAt: MONDAY + 12 * HOUR, endsAt: MONDAY + DAY + 11 * HOUR }
    expect(allowedStretches(window, limits)).toEqual([
      { startsAt: MONDAY + 12 * HOUR, endsAt: MONDAY + 15 * HOUR },
      { startsAt: MONDAY + DAY + 10 * HOUR, endsAt: MONDAY + DAY + 11 * HOUR },
    ])
    expect(allowedStretches({ startsAt: MONDAY + 16 * HOUR, endsAt: MONDAY + 20 * HOUR }, limits)).toEqual([])
  })

  it('follows the clock through a change to summer time, keeping the hours on the wall clock', () => {
    const limits = { hours: { from: 540, to: 600 }, timeZone: 'America/New_York' }
    const before = Date.UTC(2026, 2, 7)
    const stretches = allowedStretches({ startsAt: before, endsAt: before + 3 * DAY }, limits)
    expect(stretches.map((stretch) => stretch.startsAt - before)).toEqual([
      14 * HOUR,
      DAY + 13 * HOUR,
      2 * DAY + 13 * HOUR,
    ])
    expect(stretches.every((stretch) => stretch.endsAt - stretch.startsAt === HOUR)).toBe(true)
  })

  it('answers whether a span lies whole inside one stretch', () => {
    const stretches = [{ startsAt: 10, endsAt: 20 }]
    expect(isAllowed(stretches, { startsAt: 10, endsAt: 20 })).toBe(true)
    expect(isAllowed(stretches, { startsAt: 9, endsAt: 15 })).toBe(false)
    expect(isAllowed(stretches, { startsAt: 15, endsAt: 21 })).toBe(false)
    expect(isAllowed([], { startsAt: 15, endsAt: 16 })).toBe(false)
  })

  it('knows whether a meeting fits anywhere in the limits', () => {
    const limits = { hours: { from: 600, to: 630 }, timeZone: 'UTC' }
    expect(isMeetingPossible(week, 30, limits)).toBe(true)
    expect(isMeetingPossible(week, 45, limits)).toBe(false)
    expect(isMeetingPossible(week, 45, {})).toBe(true)
  })

  it('cuts free spans to what the limits allow', () => {
    const limits = { hours: { from: 600, to: 900 }, timeZone: 'UTC' }
    const window = { startsAt: MONDAY, endsAt: MONDAY + DAY }
    expect(
      clippedToLimits(
        [
          { startsAt: MONDAY + 8 * HOUR, endsAt: MONDAY + 12 * HOUR },
          { startsAt: MONDAY + 16 * HOUR, endsAt: MONDAY + 18 * HOUR },
        ],
        window,
        limits,
      ),
    ).toEqual([{ startsAt: MONDAY + 10 * HOUR, endsAt: MONDAY + 12 * HOUR }])
  })
})

describe('the limits in words', () => {
  it('names the days and hours, in the zone they are read in', () => {
    expect(
      limitsSentence({ weekdays: [3, 1], hours: { from: 600, to: 930 }, timeZone: 'Asia/Seoul' }),
    ).toContain('on Monday, Wednesday, from 10:00 to 15:30, by the clock in Asia/Seoul')
    expect(limitsSentence({ weekdays: [6], timeZone: 'UTC' })).toContain('on Saturday, by the clock in UTC')
    expect(limitsSentence({ hours: { from: 0, to: 60 }, timeZone: 'UTC' })).toContain('from 00:00 to 01:00')
  })

  it('says nothing when nothing is limited', () => {
    expect(limitsSentence({})).toBeNull()
    expect(limitsSentence({ weekdays: [1, 2, 3, 4, 5, 6, 7], timeZone: 'UTC' })).toBeNull()
    expect(limitsLines({})).toEqual([])
    expect(limitsLines({ weekdays: [1], timeZone: 'UTC' })).toHaveLength(1)
  })
})

describe('the stretches, as a property', () => {
  const limitsArb = fc.record({
    weekdays: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 6 }),
    hours: fc
      .tuple(fc.integer({ min: 0, max: 90 }), fc.integer({ min: 1, max: 40 }))
      .map(([from, length]) => ({ from: from * 15, to: Math.min(1440, (from + length) * 15) }))
      .filter((hours) => hours.to > hours.from),
    timeZone: fc.constantFrom('UTC', 'Asia/Seoul', 'America/New_York', 'Europe/London', 'Pacific/Auckland'),
  })

  it('are ordered, apart, inside the window and long enough to count', () => {
    fc.assert(
      fc.property(
        limitsArb,
        fc.integer({ min: 0, max: 400 * 24 }),
        fc.integer({ min: 1, max: 14 * 24 }),
        (limits, startHour, lengthHours) => {
          const start = Date.UTC(2026, 0, 1) + startHour * HOUR
          const window = { startsAt: start, endsAt: start + lengthHours * HOUR }
          const stretches = allowedStretches(window, limits)
          for (const [at, stretch] of stretches.entries()) {
            expect(stretch.startsAt).toBeGreaterThanOrEqual(window.startsAt)
            expect(stretch.endsAt).toBeLessThanOrEqual(window.endsAt)
            expect(stretch.endsAt).toBeGreaterThan(stretch.startsAt)
            if (at > 0) expect(stretch.startsAt).toBeGreaterThan(stretches[at - 1]!.endsAt)
          }
        },
      ),
    )
  })
})
