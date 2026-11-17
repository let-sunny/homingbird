import fc from 'fast-check'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { Option as O, err, isNone, isSome, none, ok, pipe, some } from '../src/index.ts'

const arbOption = fc.option(fc.integer(), { nil: undefined }).map((n) => (n === undefined ? none : some(n)))
const f = (n: number): O.Option<number> => (n % 2 === 0 ? some(n + 1) : none)
const g = (n: number): O.Option<number> => (n % 3 === 0 ? some(n * 2) : none)

describe('Option', () => {
  it('constructors and guards', () => {
    expect(some(1)).toMatchObject({ _tag: 'Some', value: 1 })
    expect(none._tag).toBe('None')
    expect(isSome(some(1))).toBe(true)
    expect(isSome(none)).toBe(false)
    expect(isNone(none)).toBe(true)
    expect(isNone(some(1))).toBe(false)
  })

  it('fromNullable keeps falsy values', () => {
    expect(O.fromNullable(0)).toEqual(some(0))
    expect(O.fromNullable('')).toEqual(some(''))
    expect(O.fromNullable(false)).toEqual(some(false))
    expect(O.fromNullable(null)).toBe(none)
    expect(O.fromNullable(undefined)).toBe(none)
  })

  it('monad laws', () => {
    fc.assert(
      fc.property(fc.integer(), arbOption, (a, m) => {
        expect(pipe(some(a), O.flatMap(f))).toEqual(f(a))
        expect(pipe(m, O.flatMap(some))).toEqual(m)
        expect(pipe(m, O.flatMap(f), O.flatMap(g))).toEqual(
          pipe(
            m,
            O.flatMap((x) => pipe(f(x), O.flatMap(g))),
          ),
        )
      }),
    )
  })

  it('functor laws', () => {
    fc.assert(
      fc.property(arbOption, (m) => {
        expect(
          pipe(
            m,
            O.map((x) => x),
          ),
        ).toEqual(m)
        expect(
          pipe(
            m,
            O.map((x) => x + 1),
            O.map((x) => x * 2),
          ),
        ).toEqual(
          pipe(
            m,
            O.map((x) => (x + 1) * 2),
          ),
        )
      }),
    )
  })

  it('map, filter, getOrElse, toNullable, toResult', () => {
    expect(
      pipe(
        some(1),
        O.map((n) => n + 1),
      ),
    ).toEqual(some(2))
    expect(
      pipe(
        none as O.Option<number>,
        O.map((n) => n + 1),
      ),
    ).toBe(none)
    expect(
      pipe(
        some(2),
        O.filter((n) => n > 1),
      ),
    ).toEqual(some(2))
    expect(
      pipe(
        some(1),
        O.filter((n) => n > 1),
      ),
    ).toBe(none)
    expect(
      pipe(
        none as O.Option<number>,
        O.filter(() => true),
      ),
    ).toBe(none)
    expect(
      pipe(
        some(1),
        O.getOrElse(() => 'd'),
      ),
    ).toBe(1)
    expect(
      pipe(
        none as O.Option<number>,
        O.getOrElse(() => 'd'),
      ),
    ).toBe('d')
    expect(O.toNullable(some(1))).toBe(1)
    expect(O.toNullable(none)).toBeNull()
    expect(
      pipe(
        some(1),
        O.toResult(() => 'e'),
      ),
    ).toEqual(ok(1))
    expect(
      pipe(
        none,
        O.toResult(() => 'e'),
      ),
    ).toEqual(err('e'))
  })

  describe('gen', () => {
    it('unwraps values', () => {
      const out = O.gen(function* () {
        const a = yield* some(1)
        const b = yield* some('x')
        return `${a}${b}`
      })
      expect(out).toEqual(some('1x'))
      expectTypeOf(out).toEqualTypeOf<O.Option<string>>()
    })

    it('stops at the first None and runs finally', () => {
      const log: string[] = []
      const out = O.gen(function* () {
        try {
          yield* none as O.Option<number>
          log.push('unreachable')
          return 1
        } finally {
          log.push('finally')
        }
      })
      expect(out).toBe(none)
      expect(log).toEqual(['finally'])
    })

    it('agrees with flatMap', () => {
      fc.assert(
        fc.property(arbOption, (m) => {
          const viaGen = O.gen(function* () {
            return yield* f(yield* m)
          })
          expect(viaGen).toEqual(pipe(m, O.flatMap(f)))
        }),
      )
    })
  })
})
