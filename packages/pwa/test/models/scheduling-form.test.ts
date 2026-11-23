import { SCHEDULE_WINDOW_MAX_DAYS } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { scheduleSetupFrom, schedulingFormModel, withOptional } from '../../src/models/scheduling-form.ts'
import { strings } from '../../src/strings.ts'
import { BEN, CY } from '../support/fixtures.ts'

const NOW = new Date(2026, 10, 19, 12).getTime()
const day = (month: number, date: number): number => new Date(2026, month - 1, date).getTime()
const names = (id: string): string => ({ [BEN]: 'Ben', [CY]: 'Cy' })[id] ?? '?'

type Typed = Parameters<typeof scheduleSetupFrom>[0]

const typed = (fields: Partial<Typed> = {}): Typed => ({
  title: ' Planning sync ',
  minutes: '60',
  earliestDay: '2026-11-20',
  latestDay: '2026-11-22',
  chosen: [BEN, CY],
  optional: new Set([CY]),
  ...fields,
})

const problem = (fields: Partial<Typed>): string | undefined => {
  const result = scheduleSetupFrom(typed(fields), NOW)
  return 'problem' in result ? result.problem : undefined
}

describe('schedulingFormModel', () => {
  it('starts with a week from today, half an hour, and a line for each person chosen', () => {
    const model = schedulingFormModel({ now: NOW, chosen: [BEN, CY], optional: new Set([CY]), nameOf: names })
    expect([model.earliestDay, model.latestDay]).toEqual(['2026-11-19', '2026-11-25'])
    expect(model.lengths.filter((one) => one.selected)).toEqual([
      { value: 30, label: '30 minutes', selected: true },
    ])
    expect(model.maxAttendees).toBe(7)
    expect(model.windowHint).toContain(String(SCHEDULE_WINDOW_MAX_DAYS))
    expect(model.attendees).toEqual([
      { memberId: BEN, name: 'Ben', optional: false, label: 'Optional: Ben' },
      { memberId: CY, name: 'Cy', optional: true, label: 'Optional: Cy' },
    ])
  })
})

describe('scheduleSetupFrom', () => {
  it('turns the typed form into a setup: the days from the start of the first to the end of the last', () => {
    expect(scheduleSetupFrom(typed(), NOW)).toEqual({
      setup: {
        title: 'Planning sync',
        minutes: 60,
        window: { startsAt: day(11, 20), endsAt: day(11, 23) },
        attendees: [
          { memberId: BEN, required: true },
          { memberId: CY, required: false },
        ],
      },
    })
  })

  it('starts a window whose first day is today from now, on the next quarter hour, never in the past', () => {
    const now = new Date(2026, 10, 20, 14, 7).getTime()
    expect(scheduleSetupFrom(typed(), now)).toMatchObject({
      setup: { window: { startsAt: new Date(2026, 10, 20, 14, 15).getTime(), endsAt: day(11, 23) } },
    })
    const late = new Date(2026, 10, 22, 23, 30).getTime()
    expect(scheduleSetupFrom(typed(), late)).toEqual({ problem: strings.scheduling.problems.tooLittleLeft })
  })

  it('falls back to half an hour for a length that is not offered', () => {
    expect(scheduleSetupFrom(typed({ minutes: '7' }), NOW)).toMatchObject({ setup: { minutes: 30 } })
  })

  it('names what is missing or cannot work', () => {
    expect(problem({ title: '  ' })).toBe(strings.scheduling.problems.noTitle)
    expect(problem({ chosen: [] })).toBe(strings.scheduling.problems.noAttendee)
    expect(problem({ earliestDay: '' })).toBe(strings.scheduling.problems.noDays)
    expect(problem({ latestDay: 'soon' })).toBe(strings.scheduling.problems.noDays)
    expect(problem({ earliestDay: '2026-11-22', latestDay: '2026-11-20' })).toBe(
      strings.scheduling.problems.daysOutOfOrder,
    )
    expect(problem({ latestDay: '2026-12-04' })).toBe(
      strings.scheduling.problems.tooManyDays({ days: SCHEDULE_WINDOW_MAX_DAYS }),
    )
    expect(problem({ earliestDay: '2026-11-10', latestDay: '2026-11-12' })).toBe(
      strings.scheduling.problems.passed,
    )
  })

  it('accepts a window of exactly the most days', () => {
    expect(problem({ earliestDay: '2026-11-20', latestDay: '2026-12-03' })).toBeUndefined()
  })
})

describe('withOptional', () => {
  it('marks a person optional or required again without changing the set it was given', () => {
    const none = new Set<typeof BEN>()
    const marked = withOptional(none, BEN, true)
    expect([...marked, none.size]).toEqual([BEN, 0])
    expect(withOptional(marked, BEN, false).size).toBe(0)
  })
})
