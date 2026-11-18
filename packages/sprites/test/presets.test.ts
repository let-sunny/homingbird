import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { statesFor } from '../src/dress.ts'
import { decodePng } from '../src/node/png.ts'
import { PRESETS, presetById } from '../src/presets.ts'
import { renderSheet } from '../src/render.ts'
import { validateCharacter } from '../src/rules.ts'
import { expectSamePixels } from './same-pixels.ts'

describe('presets', () => {
  it('ships 24 characters, the pigeon first', () => {
    expect(PRESETS).toHaveLength(24)
    expect(PRESETS[0]?.id).toBe('pigeon')
  })

  it.each(PRESETS.map((preset) => [preset.id, preset] as const))(
    'draws %s like the reference sheet',
    (id, preset) => {
      const reference = decodePng(readFileSync(new URL(`./golden/${id}-sheet@1x.png`, import.meta.url)))
      expectSamePixels(renderSheet(statesFor(preset), 1, { ...preset.palette }), reference)
    },
  )

  it('passes every brand rule', () => {
    for (const preset of PRESETS) expect(validateCharacter(preset), preset.id).toEqual([])
  })

  it('finds a preset by id', () => {
    expect(presetById('fox')?.name).toBe('Fox')
    expect(presetById('unicorn')).toBeUndefined()
  })
})
