import { describe, expect, it } from 'vitest'
import { limitsSummary } from '../../src/models/scheduling-limits.ts'
import { plainSpaces } from '../support/text.ts'

const window = { startsAt: Date.UTC(2026, 10, 19, 15), endsAt: Date.UTC(2026, 10, 26, 15) }

describe('limitsSummary', () => {
  it('says nothing for a flock without limits', () => {
    expect(limitsSummary({ window }, 'Asia/Seoul')).toBeNull()
    expect(limitsSummary({ window, weekdays: [1, 2, 3, 4, 5, 6, 7], timeZone: 'UTC' }, 'UTC')).toBeNull()
  })

  it('names the days and the hours, moved to the viewer’s clock', () => {
    const limits = { window, weekdays: [3, 1], hours: { from: 600, to: 900 }, timeZone: 'Asia/Seoul' }
    expect(plainSpaces(limitsSummary(limits, 'Asia/Seoul'))).toBe(
      'Only on Mon & Wed, from 10:00 AM to 3:00 PM.',
    )
    expect(plainSpaces(limitsSummary(limits, 'America/New_York'))).toBe(
      'Only on Tue & Sun, from 8:00 PM to 1:00 AM.',
    )
  })

  it('names the days alone, or the hours alone', () => {
    expect(limitsSummary({ window, weekdays: [5], timeZone: 'UTC' }, 'UTC')).toBe('Only on Fri.')
    expect(
      plainSpaces(limitsSummary({ window, hours: { from: 540, to: 600 }, timeZone: 'UTC' }, 'UTC')),
    ).toBe('Only from 9:00 AM to 10:00 AM.')
  })
})
