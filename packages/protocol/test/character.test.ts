import { PRESETS, composeCharacter, presetById, randomCharacter } from '@homingbird/sprites'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_CHARACTERS,
  CHARACTER_BYTES_MAX,
  CharacterSpec,
  builtInCharacterOf,
  characterProblems,
  isSameCharacter,
} from '../src/character.ts'
import { contract } from '../src/contract.ts'
import { Member } from '../src/model.ts'

const OTTER = {
  version: 1,
  base: 'bubble-16',
  id: 'my-otter',
  name: 'Otter',
  palette: { B: '#8A6A52', D: '#6E523F', O: '#E7D3BF', F: '#6E523F' },
  noFeet: false,
  marks: [
    [5, 1, 1, 1, 'B'],
    [10, 1, 1, 1, 'B'],
    [15, 6, 1, 1, '#2E2018'],
  ],
} as const

const pigeon = presetById('pigeon')!
const cat = presetById('cat')!

describe('characterProblems', () => {
  it('passes every built-in character exactly as it ships', () => {
    for (const preset of PRESETS) expect([preset.id, characterProblems(preset)]).toEqual([preset.id, []])
  })

  it('passes a character someone made under an id of their own', () => {
    expect(characterProblems(OTTER)).toEqual([])
  })

  it('refuses a made character that takes a built-in character’s id', () => {
    expect(characterProblems({ ...OTTER, id: 'cat' })).toEqual([
      'id: "cat" belongs to a built-in character; give your own character another id',
    ])
    expect(characterProblems({ ...cat, name: 'Tiger' })).toHaveLength(1)
  })

  it('refuses the pigeon under another id, because Pip is the brand', () => {
    expect(characterProblems({ ...pigeon, id: 'my-pigeon' })).toEqual([
      'palette: B, D and O all match Pip; Pip is the brand, make it your own',
    ])
  })

  it('refuses a changed pigeon that keeps the pigeon’s id', () => {
    const problems = characterProblems({ ...pigeon, marks: [[6, 3, 1, 1, '#6D86B0']] })
    expect(problems).toContain(
      'id: "pigeon" belongs to a built-in character; give your own character another id',
    )
  })

  it('lists the brand rules a character breaks, and adds nothing for input that is not a character', () => {
    expect(characterProblems({ ...OTTER, marks: [[12, 9, 1, 1, 'B']] })).toEqual([
      'marks may not go below the beak (x 11-15, y 8-11): characters have no mouths',
    ])
    expect(characterProblems(null).length).toBeGreaterThan(0)
    expect(characterProblems('cat').length).toBeGreaterThan(0)
    expect(characterProblems({ id: 'cat' })).toContain(
      'id: "cat" belongs to a built-in character; give your own character another id',
    )
  })

  it('passes every character the editor’s Surprise me button can make', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (seed) => {
        expect(characterProblems(composeCharacter(randomCharacter(seed)))).toEqual([])
      }),
      { numRuns: 25 },
    )
  })
})

describe('isSameCharacter', () => {
  it('sees through colour case, key order and an explicit noFeet of false', () => {
    const shuffled = {
      marks: cat.marks.map(([x, y, w, h, color]) => [x, y, w, h, color.toLowerCase()]),
      noFeet: false,
      palette: Object.fromEntries(
        Object.entries(cat.palette)
          .reverse()
          .map(([key, color]) => [key, color.toLowerCase()]),
      ),
      name: cat.name,
      id: cat.id,
      base: cat.base,
      version: cat.version,
    }
    expect(isSameCharacter(shuffled, cat)).toBe(true)
  })

  it('tells characters apart by every field that is drawn or shown', () => {
    expect(isSameCharacter({ ...cat, id: 'my-cat' }, cat)).toBe(false)
    expect(isSameCharacter({ ...cat, name: 'Kitty' }, cat)).toBe(false)
    expect(isSameCharacter({ ...cat, palette: { ...cat.palette, B: '#F2B46F' } }, cat)).toBe(false)
    expect(isSameCharacter({ ...cat, noFeet: true }, cat)).toBe(false)
    expect(isSameCharacter({ ...cat, marks: cat.marks.slice(1) }, cat)).toBe(false)
    expect(isSameCharacter({ ...cat, marks: [[6, 0, 1, 2, 'B'], ...cat.marks.slice(1)] }, cat)).toBe(false)
  })

  it('never calls something that is not a character the same', () => {
    expect(isSameCharacter(undefined, undefined)).toBe(false)
    expect(isSameCharacter({ ...cat, version: 2 }, { ...cat, version: 2 })).toBe(false)
  })
})

describe('BUILT_IN_CHARACTERS', () => {
  it('offers the 24 built-in characters, the pigeon first', () => {
    expect(BUILT_IN_CHARACTERS).toHaveLength(24)
    expect(BUILT_IN_CHARACTERS[0]).toEqual(pigeon)
  })
})

describe('builtInCharacterOf', () => {
  it('names the built-in character a spec is, and nothing for a made one', () => {
    expect(builtInCharacterOf(cat)).toBe(cat)
    expect(builtInCharacterOf(OTTER)).toBeUndefined()
  })
})

describe('characters on the wire', () => {
  it('fits the largest character the rules allow well inside the size limit', () => {
    const largest = {
      ...OTTER,
      id: 'a'.repeat(32),
      name: 'W'.repeat(20),
      palette: { B: '#8A6A52', D: '#6E523F', O: '#E7D3BF', F: '#6E523F', K: '#1B2333' },
      noFeet: true,
      marks: Array.from({ length: 80 }, () => [15, 15, 1, 1, '#ABCDEF']),
    }
    expect(CharacterSpec.is(largest)).toBe(true)
    expect(JSON.stringify(largest).length).toBeLessThan(CHARACTER_BYTES_MAX / 2)
  })

  it('shows a member with no saved character as the pigeon by sending null, and requires the field', () => {
    const member = {
      id: 'mem_abcdefghijkl',
      email: 'ana@example.com',
      name: 'Ana',
      profile: '',
      role: 'member',
      status: 'active',
      kind: 'person',
      createdAt: 1,
    }
    expect(Member.is(member)).toBe(false)
    expect(Member.is({ ...member, character: null })).toBe(true)
    expect(Member.is({ ...member, character: OTTER })).toBe(true)
    expect(Member.is({ ...member, character: { ...OTTER, version: 2 } })).toBe(false)
  })

  it('takes a character on its own routes, which only a person or an administrator may call', () => {
    expect(contract['me.character.set']).toMatchObject({
      method: 'PUT',
      path: '/me/character',
      access: 'human',
    })
    expect(contract['me.character.set'].body).toBe(CharacterSpec)
    expect(contract['me.character.clear']).toMatchObject({
      method: 'DELETE',
      path: '/me/character',
      access: 'human',
    })
    expect(contract['admin.members.resetCharacter']).toMatchObject({
      method: 'DELETE',
      path: '/admin/members/:id/character',
      access: 'admin',
    })
  })
})
