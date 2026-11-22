import { describe, expect, it } from 'vitest'
import { dateTimeText, dayHeading, isSameDay, noteTimeShown, timeShown } from '../../src/models/time.ts'
import { formats, strings } from '../../src/strings.ts'

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

describe('noteTimeShown', () => {
  it('shows the time of a note from today, and the day with the time of an earlier one', () => {
    expect(noteTimeShown(NOON - 60_000, NOON)).toEqual(timeShown(NOON - 60_000, NOON))
    const earlier = noteTimeShown(NOON - 3 * 86_400_000, NOON)
    expect(earlier.text).toBe(formats.dayTime.format(new Date(NOON - 3 * 86_400_000)))
    expect(earlier.title).toBe(formats.full.format(new Date(NOON - 3 * 86_400_000)))
  })
})

describe('dayHeading', () => {
  it('says today, yesterday, the date, and the year only for another year', () => {
    const now = new Date(2026, 10, 19, 9).getTime()
    expect(dayHeading(new Date(2026, 10, 19, 1).getTime(), now)).toBe(strings.today)
    expect(dayHeading(new Date(2026, 10, 18, 23).getTime(), now)).toBe(strings.yesterday)
    const earlier = new Date(2026, 10, 2, 12)
    expect(dayHeading(earlier.getTime(), now)).toBe(formats.date.format(earlier))
    const lastYear = new Date(2025, 10, 2, 12)
    expect(dayHeading(lastYear.getTime(), now)).toBe(formats.dateWithYear.format(lastYear))
  })
})

describe('isSameDay', () => {
  it('compares days where the person is, not moments', () => {
    expect(isSameDay(new Date(2026, 0, 1, 0, 1).getTime(), new Date(2026, 0, 1, 23, 59).getTime())).toBe(true)
    expect(isSameDay(new Date(2026, 0, 1, 23, 59).getTime(), new Date(2026, 0, 2, 0, 1).getTime())).toBe(
      false,
    )
  })
})

describe('dateTimeText', () => {
  it('writes a moment in full, or the fallback when there is none', () => {
    expect(dateTimeText(null, 'never')).toBe('never')
    expect(dateTimeText(NOON, 'never')).toBe(formats.full.format(new Date(NOON)))
  })
})
