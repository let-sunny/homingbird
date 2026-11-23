import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ANSWERS_MINUTES_MIN, answersWithinMinutes } from '../src/scheduling-deadline.ts'

const NOW = 1_800_000_000_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const meeting = (minutes: number, endsIn: number) => ({
  minutes,
  window: { startsAt: NOW, endsAt: NOW + endsIn },
})

describe('how long a scheduling room collects free times', () => {
  it('collects for a day when the window spans a week', () => {
    expect(answersWithinMinutes(meeting(60, 7 * DAY), NOW)).toBe(24 * 60)
  })

  it('stops an hour before the meeting’s last possible start when that comes within a day', () => {
    expect(answersWithinMinutes(meeting(60, 10 * HOUR), NOW)).toBe(8 * 60)
  })

  it('collects for at least two hours when the window allows it', () => {
    expect(answersWithinMinutes(meeting(30, 3 * HOUR), NOW)).toBe(2 * 60)
  })

  it('never collects past the last start that still fits the meeting', () => {
    expect(answersWithinMinutes(meeting(60, 2 * HOUR), NOW)).toBe(60)
    expect(answersWithinMinutes(meeting(60, HOUR + 30_000), NOW)).toBe(ANSWERS_MINUTES_MIN)
  })

  it('always gives a whole number of minutes between the lower limit and a day', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 32 }),
        fc.integer({ min: 0, max: 14 * DAY }),
        (quarters, extra) => {
          const minutes = quarters * 15
          const within = answersWithinMinutes(meeting(minutes, minutes * MINUTE + extra), NOW)
          expect(Number.isInteger(within)).toBe(true)
          expect(within).toBeGreaterThanOrEqual(ANSWERS_MINUTES_MIN)
          expect(within).toBeLessThanOrEqual(24 * 60)
          if (extra >= ANSWERS_MINUTES_MIN * MINUTE) expect(within * MINUTE).toBeLessThanOrEqual(extra)
        },
      ),
    )
  })
})
