import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRESETS } from '../src/presets.ts'
import { LIMITS, ZONES, validateCharacter } from '../src/rules.ts'

const cases: ReadonlyArray<{ spec: { id: string }; errors: string[] }> = JSON.parse(
  readFileSync(new URL('./fixtures/rules.json', import.meta.url), 'utf8'),
)

describe('validateCharacter', () => {
  it.each(cases.map((entry) => [entry.spec.id, entry] as const))(
    'answers %s like the reference',
    (_, entry) => {
      expect(validateCharacter(entry.spec)).toEqual(entry.errors)
    },
  )

  it('accepts every built-in character', () => {
    for (const preset of PRESETS) expect(validateCharacter(preset)).toEqual([])
  })

  it('refuses garbage with problems instead of throwing', () => {
    for (const junk of [null, 42, 'x', [], { marks: 'nope' }, { palette: null }])
      expect(validateCharacter(junk).length).toBeGreaterThan(0)
  })

  it('reports a field it cannot decode, such as noFeet that is not a boolean', () => {
    expect(validateCharacter({ ...PRESETS[1], noFeet: 'yes' })).toEqual([
      'noFeet: expected boolean, got string',
    ])
  })

  it('keeps the status-icon corner and the mouth zone apart from the zones markings may use', () => {
    const icons = ZONES.iconCorner()
    for (const cell of ZONES.headTop()) expect(icons.has(cell)).toBe(false)
    expect(ZONES.mouth().has('12,9')).toBe(true)
    expect(LIMITS.colorsMax).toBe(8)
  })
})
