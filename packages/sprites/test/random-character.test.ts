import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { composeCharacter } from '../src/editor.ts'
import { randomCharacter } from '../src/random-character.ts'
import { validateCharacter } from '../src/rules.ts'

describe('randomCharacter', () => {
  it('always makes a character that passes every rule', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (seed) => {
        expect(validateCharacter(composeCharacter(randomCharacter(seed)))).toEqual([])
      }),
      { numRuns: 300 },
    )
  })

  it('makes the same character from the same seed', () => {
    expect(randomCharacter(42)).toEqual(randomCharacter(42))
  })

  it('rarely needs to fall back to the owl', () => {
    const owls = Array.from({ length: 300 }, (_, seed) => randomCharacter(seed)).filter(
      (state) => state.name === 'Owl',
    )
    expect(owls.length).toBeLessThan(3)
  })
})
