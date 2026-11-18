import { PRESETS, composeCharacter, randomCharacter } from '@homingbird/sprites'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CHARACTER_LINK_MAX,
  CHARACTER_ROUTE,
  characterLink,
  decodeCharacter,
  encodeCharacter,
} from '../src/character-link.ts'
import { CHARACTER_BYTES_MAX, type CharacterSpec } from '../src/character.ts'

const OTTER: CharacterSpec = {
  version: 1,
  base: 'bubble-16',
  id: 'my-otter',
  name: 'Ötter 수달',
  palette: { B: '#8A6A52', D: '#6E523F', O: '#E7D3BF', F: '#6E523F' },
  marks: [
    [5, 1, 1, 1, 'B'],
    [15, 6, 1, 1, '#2E2018'],
  ],
}

describe('characterLink', () => {
  it('opens the character editor of the web client with the draft in the hash', () => {
    const link = characterLink('https://homingbird.example.com/', OTTER)
    expect(link).toBe(`https://homingbird.example.com/#/character/${encodeCharacter(OTTER)}`)
    expect(CHARACTER_ROUTE).toBe('character')
    expect(characterLink('https://h.example//', OTTER).startsWith('https://h.example/#/')).toBe(true)
  })
})

describe('encodeCharacter and decodeCharacter', () => {
  it('round-trips every built-in character, names in any script included', () => {
    for (const preset of [...PRESETS, OTTER]) expect(decodeCharacter(encodeCharacter(preset))).toEqual(preset)
  })

  it('round-trips every character Surprise me can make, using only URL-safe characters', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (seed) => {
        const spec = composeCharacter(randomCharacter(seed))
        const encoded = encodeCharacter(spec)
        expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
        expect(decodeCharacter(encoded)).toEqual(spec)
      }),
      { numRuns: 25 },
    )
  })

  it('reads nothing from a link that is empty, too long, or not base64url', () => {
    expect(decodeCharacter('')).toBeNull()
    expect(decodeCharacter('a'.repeat(CHARACTER_LINK_MAX + 1))).toBeNull()
    expect(decodeCharacter('eyJ2ZXJzaW9uIjoxfQ==')).toBeNull()
    expect(decodeCharacter('abc+')).toBeNull()
    expect(CHARACTER_LINK_MAX).toBe(Math.ceil((CHARACTER_BYTES_MAX * 4) / 3))
  })

  it('reads nothing from a link that does not hold a character', () => {
    const encode = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
    expect(decodeCharacter('a')).toBeNull()
    expect(decodeCharacter(encode('not json'))).toBeNull()
    expect(decodeCharacter(encode('{"version":1}'))).toBeNull()
    expect(decodeCharacter(Buffer.from([0xff, 0xfe]).toString('base64url'))).toBeNull()
  })

  it('reads the longest link it accepts', () => {
    const padded = { ...OTTER, padding: 'x'.repeat(CHARACTER_BYTES_MAX - 400) }
    const encoded = Buffer.from(JSON.stringify(padded), 'utf8').toString('base64url')
    expect(encoded.length).toBeLessThanOrEqual(CHARACTER_LINK_MAX)
    expect(decodeCharacter(encoded)).toEqual(OTTER)
  })
})
