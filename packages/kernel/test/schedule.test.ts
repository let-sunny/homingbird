import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Iter as I, Schedule, pipe } from '../src/index.ts'

const head = <A>(n: number, s: Iterable<A>) => pipe(s, I.take(n), I.toArray)

describe('Schedule', () => {
  it('spaced repeats one delay', () => {
    expect(head(4, Schedule.spaced(25))).toEqual([25, 25, 25, 25])
  })

  it('exponential multiplies by the factor', () => {
    expect(head(5, Schedule.exponential(100))).toEqual([100, 200, 400, 800, 1600])
    expect(head(4, Schedule.exponential(1, 3))).toEqual([1, 3, 9, 27])
  })

  it('exponential is capped at max, first delay included', () => {
    expect(head(5, Schedule.exponential(100, 2, 350))).toEqual([100, 200, 350, 350, 350])
    expect(head(2, Schedule.exponential(500, 2, 100))).toEqual([100, 100])
  })

  it('exponential never exceeds max and never decreases', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 100_000 }),
        (base, factor, max) => {
          const delays = head(20, Schedule.exponential(base, factor, max))
          delays.forEach((d, i) => {
            expect(d).toBeLessThanOrEqual(max)
            expect(d).toBe(Math.min(max, base * factor ** i))
          })
        },
      ),
    )
  })

  it('fibonacci scales the sequence by base', () => {
    expect(head(7, Schedule.fibonacci(10))).toEqual([10, 10, 20, 30, 50, 80, 130])
  })

  it('jittered spreads each delay within the ratio', () => {
    expect(head(2, Schedule.jittered(() => 0)(Schedule.spaced(100)))).toEqual([50, 50])
    expect(head(1, Schedule.jittered(() => 1)(Schedule.spaced(100)))).toEqual([150])
    expect(head(1, Schedule.jittered(() => 0.5)(Schedule.spaced(100)))).toEqual([100])
    expect(head(1, Schedule.jittered(() => 0, 0.1)(Schedule.spaced(100)))).toEqual([90])
    expect(head(1, Schedule.jittered(() => 1, 0.1)(Schedule.spaced(100)))[0]).toBeCloseTo(110)
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.integer({ min: 1, max: 1000 }), (r, ms) => {
        const [d] = head(1, Schedule.jittered(() => r)(Schedule.spaced(ms)))
        expect(d).toBeGreaterThanOrEqual(ms * 0.5)
        expect(d).toBeLessThanOrEqual(ms * 1.5)
      }),
    )
  })

  it('jittered ends when the schedule ends', () => {
    expect(I.toArray(Schedule.jittered(() => 0.5)([1, 2]))).toEqual([1, 2])
  })
})
