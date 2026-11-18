import { describe, expect, it } from 'vitest'
import {
  SLOTS,
  choicesFor,
  composeCharacter,
  editorFromPreset,
  editorFromSpec,
  emptyEditor,
} from '../src/editor.ts'
import { PRESETS } from '../src/presets.ts'
import { validateCharacter } from '../src/rules.ts'

describe('editor', () => {
  it('starts from a character that passes', () => {
    expect(validateCharacter(composeCharacter(emptyEditor()))).toEqual([])
  })

  it.each(
    SLOTS.flatMap((slot) =>
      slot.options.map((option) => [`${slot.id}/${option.id}`, slot.id, option.id] as const),
    ),
  )('passes with %s on its own', (_, slot, option) => {
    const state = emptyEditor()
    expect(
      validateCharacter(composeCharacter({ ...state, parts: { ...state.parts, [slot]: option } })),
    ).toEqual([])
  })

  it('opens every built-in character except the pigeon and keeps it passing', () => {
    for (const preset of PRESETS.filter((character) => character.id !== 'pigeon')) {
      const state = editorFromPreset(preset.id)!
      expect(validateCharacter(composeCharacter(state)), preset.id).toEqual([])
      expect(composeCharacter(state).noFeet ?? false).toBe(preset.noFeet ?? false)
    }
    expect(editorFromPreset('unicorn')).toBeUndefined()
  })

  it('refuses a copy of Pip, because Pip is the brand', () => {
    expect(validateCharacter(composeCharacter(editorFromPreset('pigeon')!)).join()).toMatch(/match Pip/)
  })

  it('turns the eye white on a dark face when the eye is automatic', () => {
    const state = emptyEditor()
    expect(composeCharacter({ ...state, parts: { ...state.parts, face: 'patch' } }).palette.K).toBe('#FFFFFF')
    expect(composeCharacter(state).palette.K).toBe('#1B2333')
  })

  it('drops the feet when something grows underneath', () => {
    const state = emptyEditor()
    expect(composeCharacter({ ...state, parts: { ...state.parts, under: 'tentacles' } }).noFeet).toBe(true)
  })

  it('names the options that would break a busy character', () => {
    const state = emptyEditor()
    const busy = {
      ...state,
      parts: { ...state.parts, spikes: 'all-round', ears: 'pointed-tips', head: 'eye-bump', tail: 'fin' },
    }
    const choices = choicesFor(busy)
    expect(choices.under.tentacles!.length).toBeGreaterThan(0)
    expect(choices.under.none).toEqual([])
  })

  it('keeps markings from a spec as their own layer', () => {
    const fox = PRESETS.find((character) => character.id === 'fox')!
    expect(editorFromSpec(fox).extra).toEqual(fox.marks)
  })
})
