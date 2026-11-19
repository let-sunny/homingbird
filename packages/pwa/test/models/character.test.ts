import { BUILT_IN_CHARACTERS } from '@homingbird/protocol'
import { SLOTS, presetById } from '@homingbird/sprites'
import { describe, expect, it } from 'vitest'
import { PIGEON, workbenchFor, workbenchFromBuiltIn, workbenchFromLink } from '../../src/characters.ts'
import {
  editorControlsModel,
  myCharacterModel,
  optionLabel,
  previewModel,
  problemsModel,
} from '../../src/models/character.ts'
import { strings } from '../../src/strings.ts'

const owl = presetById('owl')!

describe('myCharacterModel', () => {
  it('names the character in use, offers every built-in, and leaves the pigeon as it is', () => {
    const model = myCharacterModel(PIGEON, null)
    expect(model.current).toBe(strings.character.current({ character: 'Pigeon' }))
    expect(model.editorHref).toBe('#/character')
    expect(model.mayGoBackToPigeon).toBe(false)
    expect(model.choices).toHaveLength(BUILT_IN_CHARACTERS.length)
    expect(model.choices.some((choice) => choice.pressed)).toBe(false)
    expect(model.picked).toBeNull()
  })

  it('offers to use a picked character and to edit it, and the pigeon back for someone else', () => {
    const model = myCharacterModel(PIGEON, owl)
    expect(model.choices.filter((choice) => choice.pressed).map((choice) => choice.preset.id)).toEqual([
      'owl',
    ])
    expect(model.picked).toEqual({
      spec: owl,
      selected: strings.character.selected({ character: 'Owl' }),
      mayUse: true,
      saves: owl,
      editHref: '#/character?from=owl',
    })
    const back = myCharacterModel(owl, PIGEON)
    expect(back.mayGoBackToPigeon).toBe(true)
    expect(back.picked).toMatchObject({ mayUse: true, saves: null, editHref: null })
    expect(myCharacterModel(owl, owl).picked!.mayUse).toBe(false)
  })
})

describe('previewModel', () => {
  it('shows the character on a light and a dark ground, each state named', () => {
    const [light, dark] = previewModel(owl)
    expect([light!.caption, dark!.caption]).toEqual([strings.character.onLight, strings.character.onDark])
    expect(light!.states[0]).toEqual({
      state: 'idle',
      word: strings.character.states.idle,
      label: `Owl: ${strings.character.states.idle}`,
    })
  })
})

describe('problemsModel', () => {
  it('says a character passes, or names each kind of problem once', () => {
    expect(problemsModel([])).toEqual({ passes: true, text: strings.character.passes, items: [] })
    const model = problemsModel(['The name is empty.', 'The name is empty.'])
    expect(model.passes).toBe(false)
    expect(model.items).toHaveLength(1)
  })
})

describe('editorControlsModel', () => {
  it('fills every control from the workbench', () => {
    const model = editorControlsModel(workbenchFor(owl))
    expect(model.name).toBe(owl.name)
    expect(model.palette.B).toBe(model.palette.B.toLowerCase())
    expect(editorControlsModel({ ...workbenchFor(owl), layer: null }).layer).toBeNull()
    expect(Object.keys(model.parts)).toEqual(SLOTS.map((slot) => slot.id))
    expect(model.parts[SLOTS[0]!.id]!.filter((part) => part.checked)).toHaveLength(1)
  })

  it('names the layer a built-in or an agent’s link opened', () => {
    const fromBuiltIn = workbenchFromBuiltIn('owl')!
    expect(editorControlsModel(fromBuiltIn).layer).toEqual({
      kept: fromBuiltIn.layer!.kept,
      text: strings.character.layer['built-in']({ character: 'Owl' }),
    })
    const unnamed = { ...fromBuiltIn, layer: { ...fromBuiltIn.layer!, builtIn: null } }
    expect(editorControlsModel(unnamed).layer!.text).toBe(
      strings.character.layer['built-in']({ character: '' }),
    )
    const strange = { ...fromBuiltIn, layer: { ...fromBuiltIn.layer!, builtIn: 'dragon' } }
    expect(editorControlsModel(strange).layer!.text).toBe(
      strings.character.layer['built-in']({ character: 'dragon' }),
    )
    const agent = { ...fromBuiltIn, layer: { ...fromBuiltIn.layer!, source: 'agent' as const } }
    expect(editorControlsModel(agent).layer!.text).toBe(strings.character.layer.agent)
  })

  it('switches off the parts the character cannot combine, and says why', () => {
    const bench = workbenchFor(owl)
    const blocked = SLOTS.flatMap((slot) =>
      editorControlsModel({
        ...bench,
        editor: { ...bench.editor, parts: { ...bench.editor.parts, under: 'skirt' } },
      }).parts[slot.id]!.filter((part) => part.disabled),
    )
    for (const part of blocked) expect(part.reason).not.toBe('')
    expect(workbenchFromLink('not a link')).toBeNull()
  })
})

describe('optionLabel', () => {
  it('names a part in the reader’s language, or by its id', () => {
    const slot = SLOTS[0]!
    const option = slot.options[0]!
    expect(optionLabel(slot.id, option.id)).toBe(
      (strings.character.options[slot.id] as Record<string, string>)[option.id] ?? option.id,
    )
    expect(optionLabel(slot.id, 'no-such-part')).toBe('no-such-part')
  })
})
