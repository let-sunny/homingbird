import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type Meeting,
  QUARTER_HOUR_MS,
  type TimeSpan,
  closestSlot,
  earliestCommonSlot,
  isFreeThrough,
  windowAheadOf,
} from '../src/common-slot.ts'
import { MemberId } from '../src/ids.ts'
import { type ScheduleLimits, allowedStretches, isAllowed } from '../src/schedule-limits.ts'

const DAY = Date.UTC(2026, 10, 23)
const MINUTE = 60_000
const at = (hours: number, minutes = 0) => DAY + hours * 60 * MINUTE + minutes * MINUTE
const span = (startsAt: number, endsAt: number): TimeSpan => ({ startsAt, endsAt })
const WINDOW = span(at(9), at(17))
const HOUR: Meeting = { minutes: 60, window: WINDOW }

const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')
const CY = MemberId.of('cy0000000000')

describe('the earliest common slot', () => {
  it('starts on the first quarter hour everyone is free for the whole meeting', () => {
    const ana = [span(at(9, 10), at(12))]
    const ben = [span(at(10, 50), at(11, 30)), span(at(11, 30), at(13))]
    expect(earliestCommonSlot(HOUR, [ana, ben])).toEqual(span(at(11), at(12)))
  })

  it('stays inside the window, reading free time outside it as no time at all', () => {
    expect(earliestCommonSlot(HOUR, [[span(at(7), at(9, 30))]])).toBeNull()
    expect(earliestCommonSlot(HOUR, [[span(at(16, 30), at(20))]])).toBeNull()
    expect(earliestCommonSlot(HOUR, [[span(at(8), at(10))]])).toEqual(span(at(9), at(10)))
    expect(earliestCommonSlot(HOUR, [[span(at(16), at(20))]])).toEqual(span(at(16), at(17)))
  })

  it('rounds a window that starts off the quarter hour up to the next one', () => {
    const meeting = { minutes: 30, window: span(at(9, 1), at(10)) }
    expect(earliestCommonSlot(meeting, [])).toEqual(span(at(9, 15), at(9, 45)))
    expect(earliestCommonSlot({ minutes: 60, window: meeting.window }, [])).toBeNull()
  })

  it('finds nothing for a person with no free time, or a free time shorter than the meeting', () => {
    expect(earliestCommonSlot(HOUR, [[], [span(at(9), at(17))]])).toBeNull()
    expect(earliestCommonSlot(HOUR, [[span(at(9), at(9, 59))]])).toBeNull()
    expect(earliestCommonSlot(HOUR, [[span(at(10), at(9))]])).toBeNull()
  })

  it('tries every person’s free starts in time order, not in the order the people come', () => {
    const ana = [span(at(9), at(12)), span(at(14), at(15))]
    const ben = [span(at(10), at(11)), span(at(14), at(15))]
    expect(earliestCommonSlot(HOUR, [ana, ben])).toEqual(span(at(10), at(11)))
  })

  it('joins free spans that overlap or touch, but not ones with a gap between them', () => {
    const touching = [span(at(9), at(9, 30)), span(at(9, 30), at(10))]
    const nested = [span(at(9), at(12)), span(at(9, 15), at(9, 20)), span(at(11), at(11, 30))]
    expect(earliestCommonSlot(HOUR, [touching])).toEqual(span(at(9), at(10)))
    expect(earliestCommonSlot(HOUR, [nested, nested])).toEqual(span(at(9), at(10)))
    expect(earliestCommonSlot(HOUR, [[span(at(9), at(9, 30)), span(at(9, 31), at(10))]])).toBeNull()
  })

  it('is sound: everyone given is free for the whole slot, which starts on a quarter hour in the window', () => {
    fc.assert(
      fc.property(meetings, people, (meeting, free) => {
        const slot = earliestCommonSlot(meeting, free)
        if (slot === null) return
        expect(slot.startsAt % QUARTER_HOUR_MS).toBe(0)
        expect(slot.endsAt - slot.startsAt).toBe(meeting.minutes * MINUTE)
        expect(slot.startsAt).toBeGreaterThanOrEqual(meeting.window.startsAt)
        expect(slot.endsAt).toBeLessThanOrEqual(meeting.window.endsAt)
        for (const spans of free) expect(isCovered(spans, slot)).toBe(true)
      }),
    )
  })

  it('is minimal: no earlier quarter hour in the window suits everyone, and none at all when it finds none', () => {
    fc.assert(
      fc.property(meetings, people, (meeting, free) => {
        expect(earliestCommonSlot(meeting, free)).toEqual(bruteForce(meeting, free))
      }),
    )
  })

  it('does not depend on the order of the people or of their free spans', () => {
    fc.assert(
      fc.property(
        meetings,
        people.chain((free) =>
          fc.tuple(
            fc.constant(free),
            fc.shuffledSubarray(
              free.map((spans) => [...spans].reverse()),
              { minLength: free.length, maxLength: free.length },
            ),
          ),
        ),
        (meeting, [free, shuffled]) => {
          expect(earliestCommonSlot(meeting, shuffled)).toEqual(earliestCommonSlot(meeting, free))
        },
      ),
    )
  })

  it('never gets later when someone adds free time', () => {
    fc.assert(
      fc.property(meetings, people, freeSpan, fc.nat(), (meeting, free, extra, who) => {
        if (free.length === 0) return
        const index = who % free.length
        const more = free.map((spans, at) => (at === index ? [...spans, extra] : spans))
        expect(startOf(earliestCommonSlot(meeting, more))).toBeLessThanOrEqual(
          startOf(earliestCommonSlot(meeting, free)),
        )
      }),
    )
  })

  it('never gets earlier when another required person joins', () => {
    fc.assert(
      fc.property(meetings, people, spansOfOne, (meeting, free, another) => {
        expect(startOf(earliestCommonSlot(meeting, [...free, another]))).toBeGreaterThanOrEqual(
          startOf(earliestCommonSlot(meeting, free)),
        )
      }),
    )
  })
})

describe('the closest slot', () => {
  it('names who is busy at the earliest time that misses the fewest people', () => {
    const people = [
      { memberId: ANA, free: [span(at(9), at(10)), span(at(14), at(15))] },
      { memberId: BEN, free: [span(at(14), at(15))] },
      { memberId: CY, free: [span(at(9), at(10))] },
    ]
    expect(closestSlot(HOUR, people)).toEqual({ ...span(at(9), at(10)), missing: [BEN] })
  })

  it('is null when nobody is free for the meeting, or nobody is asked', () => {
    expect(closestSlot(HOUR, [{ memberId: ANA, free: [span(at(9), at(9, 30))] }])).toBeNull()
    expect(closestSlot(HOUR, [])).toBeNull()
    expect(closestSlot({ minutes: 600, window: WINDOW }, [{ memberId: ANA, free: [WINDOW] }])).toBeNull()
  })

  it('misses no one exactly when a common slot exists, and then it is that slot', () => {
    fc.assert(
      fc.property(meetings, people, (meeting, free) => {
        const named = free.map((spans, index) => ({ memberId: MEMBERS[index]!, free: spans }))
        const closest = closestSlot(meeting, named)
        const slot = earliestCommonSlot(meeting, free)
        if (slot !== null && free.length > 0) expect(closest).toEqual({ ...slot, missing: [] })
        if (slot === null && closest !== null) {
          expect(closest.missing.length).toBeGreaterThan(0)
          expect(closest.missing.length).toBeLessThan(free.length)
          for (const person of named)
            expect(isCovered(person.free, closest)).toBe(!closest.missing.includes(person.memberId))
        }
      }),
    )
  })
})

describe('whether free spans cover a time', () => {
  it('reads overlapping and touching spans as one free time', () => {
    expect(isFreeThrough([span(at(9), at(10)), span(at(10), at(11))], span(at(9, 30), at(10, 30)))).toBe(true)
    expect(isFreeThrough([span(at(9), at(10)), span(at(10, 1), at(11))], span(at(9, 30), at(10, 30)))).toBe(
      false,
    )
    expect(isFreeThrough([], span(at(9), at(10)))).toBe(false)
  })
})

const MEMBERS = Array.from({ length: 8 }, (_, index) => MemberId.of(`member00000${index}`))

const minute = fc.integer({ min: 0, max: 12 * 60 })
const freeSpan = fc
  .tuple(minute, fc.integer({ min: 1, max: 6 * 60 }), fc.integer({ min: 0, max: 59_999 }))
  .map(([start, length, ms]) => span(at(6, start) + ms, at(6, start + length) + ms))
const spansOfOne = fc.array(freeSpan, { maxLength: 6 })
const people = fc.array(spansOfOne, { maxLength: 5 })
const meetings = fc
  .tuple(
    fc.integer({ min: 0, max: 6 * 60 }),
    fc.integer({ min: 1, max: 10 * 60 }),
    fc.integer({ min: 1, max: 16 }),
  )
  .map(([start, length, quarters]) => ({
    minutes: quarters * 15,
    window: span(at(6, start), at(6, start + length)),
  }))

/** Half-open spans cover a time when they cover its start and every one of their ends inside it. */
const isCovered = (spans: ReadonlyArray<TimeSpan>, time: TimeSpan): boolean =>
  [
    time.startsAt,
    ...spans.map((one) => one.endsAt).filter((end) => end > time.startsAt && end < time.endsAt),
  ].every((point) => spans.some((one) => one.startsAt <= point && point < one.endsAt))

const bruteForce = (meeting: Meeting, free: ReadonlyArray<ReadonlyArray<TimeSpan>>): TimeSpan | null => {
  const length = meeting.minutes * MINUTE
  const first = Math.ceil(meeting.window.startsAt / QUARTER_HOUR_MS) * QUARTER_HOUR_MS
  for (let start = first; start + length <= meeting.window.endsAt; start += QUARTER_HOUR_MS) {
    const time = span(start, start + length)
    if (free.every((spans) => isCovered(spans, time))) return time
  }
  return null
}

const startOf = (slot: TimeSpan | null): number => slot?.startsAt ?? Number.POSITIVE_INFINITY

describe('what is left of a window from now', () => {
  it('starts at the next quarter hour once the window has begun, and is the window before then', () => {
    expect(windowAheadOf(WINDOW, at(8))).toEqual(WINDOW)
    expect(windowAheadOf(WINDOW, at(9))).toEqual(WINDOW)
    expect(windowAheadOf(WINDOW, at(10, 1))).toEqual(span(at(10, 15), at(17)))
    expect(windowAheadOf(WINDOW, at(10, 15))).toEqual(span(at(10, 15), at(17)))
  })
})

const ZONES = ['UTC', 'Asia/Seoul', 'America/New_York', 'Europe/London', 'Pacific/Auckland'] as const
const limitsOf = fc
  .record(
    {
      weekdays: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 6 }),
      hours: fc
        .tuple(fc.integer({ min: 0, max: 90 }), fc.integer({ min: 1, max: 48 }))
        .map(([from, length]) => ({ from: from * 15, to: Math.min(1440, (from + length) * 15) })),
    },
    { requiredKeys: [] },
  )
  .chain((limits) => fc.constantFrom(...ZONES).map((timeZone): ScheduleLimits => ({ ...limits, timeZone })))
const longMeetings = fc
  .tuple(
    fc.integer({ min: 0, max: 400 * 24 }),
    fc.integer({ min: 12, max: 14 * 24 }),
    fc.integer({ min: 1, max: 12 }),
  )
  .map(([startHour, lengthHours, quarters]) => ({
    minutes: quarters * 15,
    window: span(
      Date.UTC(2026, 0, 1) + startHour * 60 * MINUTE,
      Date.UTC(2026, 0, 1) + (startHour + lengthHours) * 60 * MINUTE,
    ),
  }))
const freeAcrossWindow = (meeting: Meeting) =>
  fc.array(
    fc
      .tuple(fc.integer({ min: 0, max: 14 * 24 }), fc.integer({ min: 1, max: 12 }))
      .map(([from, length]) =>
        span(
          meeting.window.startsAt + from * 60 * MINUTE,
          meeting.window.startsAt + (from + length) * 60 * MINUTE,
        ),
      ),
    { maxLength: 6 },
  )

describe('the earliest common slot inside chosen weekdays and hours', () => {
  it('always lies whole inside them, in the zone of whoever opened the room', () => {
    fc.assert(
      fc.property(
        longMeetings.chain((meeting) =>
          fc.tuple(fc.constant(meeting), limitsOf, fc.array(freeAcrossWindow(meeting), { maxLength: 3 })),
        ),
        ([meeting, limits, everyone]) => {
          const found = earliestCommonSlot({ ...meeting, limits }, everyone)
          if (found === null) return
          expect(isAllowed(allowedStretches(meeting.window, limits), found)).toBe(true)
          expect(found.endsAt - found.startsAt).toBe(meeting.minutes * MINUTE)
        },
      ),
    )
  })

  it('is never later without a limit than with it', () => {
    fc.assert(
      fc.property(
        longMeetings.chain((meeting) =>
          fc.tuple(fc.constant(meeting), limitsOf, fc.array(freeAcrossWindow(meeting), { maxLength: 3 })),
        ),
        ([meeting, limits, everyone]) => {
          const limited = earliestCommonSlot({ ...meeting, limits }, everyone)
          const free = earliestCommonSlot(meeting, everyone)
          const dropped: ScheduleLimits[] = [
            {},
            { timeZone: limits.timeZone!, ...(limits.hours === undefined ? {} : { hours: limits.hours }) },
            {
              timeZone: limits.timeZone!,
              ...(limits.weekdays === undefined ? {} : { weekdays: limits.weekdays }),
            },
          ]
          expect(startOf(free)).toBeLessThanOrEqual(startOf(limited))
          for (const looser of dropped) {
            const found = earliestCommonSlot({ ...meeting, limits: looser }, everyone)
            expect(startOf(found)).toBeLessThanOrEqual(startOf(limited))
          }
        },
      ),
    )
  })

  it('matches a search over every quarter hour inside the limits', () => {
    fc.assert(
      fc.property(
        longMeetings.chain((meeting) =>
          fc.tuple(fc.constant(meeting), limitsOf, fc.array(freeAcrossWindow(meeting), { maxLength: 3 })),
        ),
        ([meeting, limits, everyone]) => {
          const stretches = allowedStretches(meeting.window, limits)
          const length = meeting.minutes * MINUTE
          const first = Math.ceil(meeting.window.startsAt / QUARTER_HOUR_MS) * QUARTER_HOUR_MS
          let expected: TimeSpan | null = null
          for (
            let start = first;
            start + length <= meeting.window.endsAt && expected === null;
            start += QUARTER_HOUR_MS
          ) {
            const time = span(start, start + length)
            if (isAllowed(stretches, time) && everyone.every((spans) => isCovered(spans, time)))
              expected = time
          }
          expect(earliestCommonSlot({ ...meeting, limits }, everyone)).toEqual(expected)
        },
      ),
      { numRuns: 60 },
    )
  })

  it('finds the first allowed hour on a chosen day, even when everyone is free all week', () => {
    const week = span(Date.UTC(2026, 10, 23), Date.UTC(2026, 10, 30))
    const limits = { weekdays: [3], hours: { from: 600, to: 720 }, timeZone: 'Asia/Seoul' }
    const found = earliestCommonSlot({ minutes: 60, window: week, limits }, [[week]])
    expect(found).toEqual(span(Date.UTC(2026, 10, 25, 1), Date.UTC(2026, 10, 25, 2)))
    expect(earliestCommonSlot({ minutes: 150, window: week, limits }, [[week]])).toBeNull()
  })

  it('has a closest slot inside the limits too', () => {
    const week = span(Date.UTC(2026, 10, 23), Date.UTC(2026, 10, 30))
    const limits = { weekdays: [3], timeZone: 'UTC' }
    const closest = closestSlot({ minutes: 60, window: week, limits }, [
      { memberId: ANA, free: [week] },
      { memberId: BEN, free: [span(Date.UTC(2026, 10, 24), Date.UTC(2026, 10, 24, 5))] },
    ])
    expect(closest).toEqual({ ...span(Date.UTC(2026, 10, 25), Date.UTC(2026, 10, 25, 1)), missing: [BEN] })
  })
})
