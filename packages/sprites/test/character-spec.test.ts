import { isOk } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { CHARACTER_SPEC_JSON_SCHEMA, CharacterSpec } from '../src/character-spec.ts'
import { PRESETS } from '../src/presets.ts'

describe('CharacterSpec', () => {
  it('decodes every built-in character', () => {
    for (const preset of PRESETS) expect(isOk(CharacterSpec.decode(preset))).toBe(true)
  })

  it('refuses a mark that is not [x, y, w, h, color]', () => {
    const broken = { ...PRESETS[1], marks: [[1, 2, 3, 'B', 4]] }
    expect(isOk(CharacterSpec.decode(broken))).toBe(false)
  })

  it('refuses a fifth field of the wrong kind and a version other than 1', () => {
    expect(isOk(CharacterSpec.decode({ ...PRESETS[1], version: 2 }))).toBe(false)
    expect(isOk(CharacterSpec.decode({ ...PRESETS[1], marks: [[1, 2, 3, 4, 5]] }))).toBe(false)
  })

  it('describes itself as JSON Schema for tool inputs', () => {
    expect(CHARACTER_SPEC_JSON_SCHEMA).toMatchObject({ type: 'object' })
  })
})
