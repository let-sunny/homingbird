import fc from 'fast-check'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  type Brand,
  type Simplify,
  type UnionToIntersection,
  absurd,
  constant,
  flow,
  identity,
  noop,
  pipe,
} from '../src/index.ts'

const inc = (n: number) => n + 1
const double = (n: number) => n * 2

describe('fn', () => {
  it('identity returns its argument', () => {
    fc.assert(fc.property(fc.anything(), (a) => Object.is(identity(a), a)))
  })

  it('constant ignores later calls', () => {
    const f = constant(7)
    expect(f()).toBe(7)
    expect(f()).toBe(7)
  })

  it('noop returns undefined', () => {
    expect(noop()).toBeUndefined()
  })

  it('absurd throws with the offending value', () => {
    expect(() => absurd('x' as never)).toThrow('Unreachable: "x"')
  })

  it('pipe applies functions left to right for every arity', () => {
    expect(pipe(1)).toBe(1)
    expect(pipe(1, inc)).toBe(2)
    expect(pipe(1, inc, double)).toBe(4)
    expect(pipe(1, inc, double, inc)).toBe(5)
    expect(pipe(1, inc, double, inc, double)).toBe(10)
    expect(pipe(1, inc, double, inc, double, inc)).toBe(11)
    expect(pipe(1, inc, double, inc, double, inc, double)).toBe(22)
    expect(pipe(1, inc, double, inc, double, inc, double, String)).toBe('22')
  })

  it('flow composes left to right for every arity', () => {
    expect(flow(inc)(1)).toBe(2)
    expect(flow(inc, double)(1)).toBe(4)
    expect(flow(inc, double, inc)(1)).toBe(5)
    expect(flow(inc, double, inc, String)(1)).toBe('5')
  })

  it('pipe(a, f, g) equals flow(f, g)(a)', () => {
    fc.assert(fc.property(fc.integer(), (n) => pipe(n, inc, double) === flow(inc, double)(n)))
  })

  it('types', () => {
    expectTypeOf(pipe(1, inc, String)).toEqualTypeOf<string>()
    expectTypeOf(flow(inc, String)).toEqualTypeOf<(a: number) => string>()
    expectTypeOf<UnionToIntersection<{ a: 1 } | { b: 2 }>>().toEqualTypeOf<{ a: 1 } & { b: 2 }>()
    expectTypeOf<UnionToIntersection<never>>().toEqualTypeOf<unknown>()
    expectTypeOf<Simplify<{ a: 1 } & { b: 2 }>>().toEqualTypeOf<{ a: 1; b: 2 }>()
    type Id = Brand<string, 'Id'>
    expectTypeOf<Id>().toMatchTypeOf<string>()
    expectTypeOf<string>().not.toMatchTypeOf<Id>()
    expectTypeOf<Brand<string, 'Other'>>().not.toMatchTypeOf<Id>()
  })
})
