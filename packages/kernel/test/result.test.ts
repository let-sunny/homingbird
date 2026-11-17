import fc from 'fast-check'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { Result as R, err, isErr, isOk, ok, pipe } from '../src/index.ts'

const arbResult = fc.oneof(fc.integer().map((n) => ok(n)), fc.string().map((e) => err(e))) as fc.Arbitrary<
  R.Result<number, string>
>
const f = (n: number): R.Result<number, string> => (n % 2 === 0 ? ok(n + 1) : err(`odd ${n}`))
const g = (n: number): R.Result<number, string> => (n % 3 === 0 ? ok(n * 2) : err(`not3 ${n}`))

describe('Result', () => {
  it('constructors and guards', () => {
    expect(ok(1)).toMatchObject({ _tag: 'Ok', value: 1 })
    expect(err('e')).toMatchObject({ _tag: 'Err', error: 'e' })
    expect(isOk(ok(1))).toBe(true)
    expect(isOk(err(1))).toBe(false)
    expect(isErr(err(1))).toBe(true)
    expect(isErr(ok(1))).toBe(false)
  })

  it('isResult recognises only kernel results', () => {
    expect(R.isResult(ok(1))).toBe(true)
    expect(R.isResult(err(1))).toBe(true)
    expect(R.isResult({ _tag: 'Ok', value: 1 })).toBe(false)
    expect(R.isResult(null)).toBe(false)
    expect(R.isResult('Ok')).toBe(false)
  })

  it('monad laws', () => {
    fc.assert(
      fc.property(fc.integer(), arbResult, (a, m) => {
        expect(pipe(ok(a), R.flatMap(f))).toEqual(f(a))
        expect(pipe(m, R.flatMap(ok))).toEqual(m)
        expect(pipe(m, R.flatMap(f), R.flatMap(g))).toEqual(pipe(m, R.flatMap((x) => pipe(f(x), R.flatMap(g)))))
      }),
    )
  })

  it('functor laws', () => {
    fc.assert(
      fc.property(arbResult, (m) => {
        expect(pipe(m, R.map((x) => x))).toEqual(m)
        expect(pipe(m, R.map((x) => x + 1), R.map((x) => x * 2))).toEqual(pipe(m, R.map((x) => (x + 1) * 2)))
      }),
    )
  })

  it('map and mapError touch only their side', () => {
    expect(pipe(ok(1), R.map((n) => n + 1))).toEqual(ok(2))
    expect(pipe(err('e') as R.Result<number, string>, R.map((n) => n + 1))).toEqual(err('e'))
    expect(pipe(err('e'), R.mapError((e) => e.length))).toEqual(err(1))
    expect(pipe(ok(1) as R.Result<number, string>, R.mapError((e) => e.length))).toEqual(ok(1))
  })

  it('orElse recovers only errors', () => {
    expect(pipe(err('e') as R.Result<number, string>, R.orElse((e) => ok(e.length)))).toEqual(ok(1))
    expect(pipe(err('e') as R.Result<number, string>, R.orElse((e) => err(e.length)))).toEqual(err(1))
    expect(pipe(ok(5) as R.Result<number, string>, R.orElse(() => ok(0)))).toEqual(ok(5))
  })

  it('fold and getOrElse', () => {
    const show = R.fold(
      (e: string) => `E:${e}`,
      (a: number) => `A:${a}`,
    )
    expect(show(ok(1))).toBe('A:1')
    expect(show(err('x'))).toBe('E:x')
    expect(pipe(ok(1) as R.Result<number, string>, R.getOrElse((e) => e.length))).toBe(1)
    expect(pipe(err('abc') as R.Result<number, string>, R.getOrElse((e) => e.length))).toBe(3)
  })

  it('unwrap returns the value or throws the error', () => {
    expect(R.unwrap(ok(1))).toBe(1)
    const boom = new Error('boom')
    expect(() => R.unwrap(err(boom))).toThrow(boom)
    expect(() => R.unwrap(err({ code: 1 }))).toThrow('unwrap on Err: {"code":1}')
  })

  it('fromNullable', () => {
    const check = R.fromNullable(() => 'missing')
    expect(check(0)).toEqual(ok(0))
    expect(check('')).toEqual(ok(''))
    expect(check(null)).toEqual(err('missing'))
    expect(check(undefined)).toEqual(err('missing'))
  })

  it('attempt captures throws', () => {
    expect(R.attempt(() => 1, String)).toEqual(ok(1))
    expect(
      R.attempt(
        () => {
          throw new Error('bad')
        },
        (cause) => (cause as Error).message,
      ),
    ).toEqual(err('bad'))
  })

  it('all collects or stops at the first error', () => {
    fc.assert(
      fc.property(fc.array(arbResult), (rs) => {
        const firstErr = rs.find(isErr)
        expect(R.all(rs)).toEqual(firstErr ?? ok(rs.map((r) => (r as R.Ok<number>).value)))
      }),
    )
  })

  it('all does not consume past the first error', () => {
    let pulled = 0
    function* source() {
      for (const r of [ok(1), err('x'), ok(2)]) {
        pulled++
        yield r
      }
    }
    expect(R.all(source())).toEqual(err('x'))
    expect(pulled).toBe(2)
  })

  it('partition keeps everything in order', () => {
    expect(R.partition([ok(1), err('a'), ok(2), err('b')])).toEqual({ oks: [1, 2], errs: ['a', 'b'] })
    expect(R.partition([])).toEqual({ oks: [], errs: [] })
  })

  describe('gen', () => {
    it('unwraps values', () => {
      const out = R.gen(function* () {
        const a = yield* ok(1)
        const b = yield* ok(2)
        return a + b
      })
      expect(out).toEqual(ok(3))
    })

    it('stops at the first error and runs finally', () => {
      const log: string[] = []
      const out = R.gen(function* () {
        try {
          log.push('start')
          yield* err('first') as R.Result<number, string>
          log.push('unreachable')
          yield* err('second')
          return 1
        } finally {
          log.push('finally')
        }
      })
      expect(out).toEqual(err('first'))
      expect(log).toEqual(['start', 'finally'])
    })

    it('agrees with flatMap', () => {
      fc.assert(
        fc.property(arbResult, (m) => {
          const viaGen = R.gen(function* () {
            const a = yield* m
            return yield* f(a)
          })
          expect(viaGen).toEqual(pipe(m, R.flatMap(f)))
        }),
      )
    })

    it('infers the union of errors', () => {
      const out = R.gen(function* () {
        const a = yield* ok(1) as R.Result<number, 'a'>
        const b = yield* ok('x') as R.Result<string, 'b'>
        return { a, b }
      })
      expectTypeOf(out).toEqualTypeOf<R.Result<{ a: number; b: string }, 'a' | 'b'>>()
      expectTypeOf(R.gen(function* () { return 1 })).toEqualTypeOf<R.Result<number, never>>()
    })
  })

  it('types', () => {
    expectTypeOf<R.ValueOf<R.Result<number, string>>>().toEqualTypeOf<number>()
    expectTypeOf<R.ErrorOf<R.Result<number, string>>>().toEqualTypeOf<string>()
    const chained: R.Result<never, 'a' | 'b'> = pipe(
      ok(1) as R.Result<number, 'a'>,
      R.flatMap(() => err('b' as const)),
    )
    expectTypeOf(chained).not.toBeAny()
  })
})
