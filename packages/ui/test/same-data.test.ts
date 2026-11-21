import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isSameData } from '../src/same-data.ts'

describe('isSameData', () => {
  it('holds for a value and a deep copy of it, both ways', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const copy = structuredClone(value)
        return isSameData(value, copy) && isSameData(copy, value)
      }),
    )
  })

  it('is symmetric for any two values', () => {
    fc.assert(fc.property(fc.jsonValue(), fc.jsonValue(), (a, b) => isSameData(a, b) === isSameData(b, a)))
  })

  it('compares arrays, maps, sets and records by their contents', () => {
    expect(isSameData([1, { a: 'x' }], [1, { a: 'x' }])).toBe(true)
    expect(isSameData([1, 2], [1, 2, 3])).toBe(false)
    expect(isSameData([1, 2], [1, 3])).toBe(false)
    expect(isSameData(new Map([['a', { n: 1 }]]), new Map([['a', { n: 1 }]]))).toBe(true)
    expect(isSameData(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(false)
    expect(isSameData(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false)
    expect(isSameData(new Map(), new Map([['a', 1]]))).toBe(false)
    expect(isSameData(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
    expect(isSameData(new Set(['a']), new Set(['b']))).toBe(false)
    expect(isSameData(new Set(['a']), new Set(['a', 'b']))).toBe(false)
    expect(isSameData({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false)
    expect(isSameData({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(isSameData(Number.NaN, Number.NaN)).toBe(true)
  })

  it('never mistakes one kind of collection, or a primitive, for another', () => {
    expect(isSameData([], {})).toBe(false)
    expect(isSameData({}, [])).toBe(false)
    expect(isSameData(new Map(), {})).toBe(false)
    expect(isSameData({}, new Map())).toBe(false)
    expect(isSameData(new Set(), {})).toBe(false)
    expect(isSameData({}, new Set())).toBe(false)
    expect(isSameData(new Map(), new Set())).toBe(false)
    expect(isSameData(null, {})).toBe(false)
    expect(isSameData({}, null)).toBe(false)
    expect(isSameData(1, '1')).toBe(false)
  })
})
