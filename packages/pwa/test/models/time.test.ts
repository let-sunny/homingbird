import { describe, expect, it } from 'vitest'
import { dateTimeText, timeShown } from '../../src/models/time.ts'
import { formats } from '../../src/strings.ts'

const NOON = Date.UTC(2026, 10, 19, 12)

describe('timeShown', () => {
  it('shows the time for a moment today and the day for an earlier one, with the full date as a title', () => {
    const today = timeShown(NOON - 60_000, NOON)
    expect(today).toEqual({
      datetime: new Date(NOON - 60_000).toISOString(),
      title: formats.full.format(new Date(NOON - 60_000)),
      text: formats.time.format(new Date(NOON - 60_000)),
    })
    const earlier = timeShown(NOON - 3 * 86_400_000, NOON)
    expect(earlier.text).toBe(formats.day.format(new Date(NOON - 3 * 86_400_000)))
  })
})

describe('dateTimeText', () => {
  it('writes a moment in full, or the fallback when there is none', () => {
    expect(dateTimeText(null, 'never')).toBe('never')
    expect(dateTimeText(NOON, 'never')).toBe(formats.full.format(new Date(NOON)))
  })
})
