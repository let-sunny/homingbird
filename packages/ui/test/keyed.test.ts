import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { applyKeyedOperations, keyedOperations } from '../src/keyed.ts'

describe('keyedOperations', () => {
  it('yields nothing when the order is unchanged', () => {
    expect([...keyedOperations(['a', 'b'], ['a', 'b'])]).toEqual([])
  })

  it('appends a new key without touching the others', () => {
    expect([...keyedOperations(['a', 'b'], ['a', 'b', 'c'])]).toEqual([{ type: 'place', key: 'c', before: null }])
  })

  it('removes keys that are gone', () => {
    expect([...keyedOperations(['a', 'b', 'c'], ['a', 'c'])]).toEqual([{ type: 'remove', key: 'b' }])
  })

  it('places a key before its new neighbour', () => {
    expect([...keyedOperations(['a', 'b'], ['x', 'a', 'b'])]).toEqual([{ type: 'place', key: 'x', before: 'a' }])
  })

  it('transforms any list of unique keys into any other', () => {
    const keys = fc.uniqueArray(fc.integer({ min: 0, max: 30 }), { maxLength: 12 })
    fc.assert(
      fc.property(keys, keys, (previous, next) => {
        expect(applyKeyedOperations(previous, keyedOperations(previous, next))).toEqual(next)
      }),
    )
  })
})
