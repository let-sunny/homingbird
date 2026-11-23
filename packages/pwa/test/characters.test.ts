import {
  BUILT_IN_CHARACTERS,
  type MemberId,
  characterForMember,
  characterProblems,
  encodeCharacter,
  isPipLook,
} from '@homingbird/protocol'
import { PRESETS, SLOTS, presetById } from '@homingbird/sprites'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  PIGEON,
  PREVIEW_STATES,
  PROBLEM_KIND_NAMES,
  ROBOT,
  blockedParts,
  builtInIdOf,
  characterOf,
  editorStateOf,
  framePixels,
  frameTimings,
  hasSavedCharacter,
  idFrom,
  problemKindOf,
  problemsOf,
  renamed,
  specOf,
  surprise,
  workbenchFor,
  workbenchFromBuiltIn,
  workbenchFromLink,
} from '../src/characters.ts'

const ANA = 'mem_ana' as MemberId

const OTTER = {
  version: 1 as const,
  base: 'bubble-16' as const,
  id: 'my-otter',
  name: 'Otter',
  palette: { B: '#8A6A52', D: '#6E523F', O: '#E7D3BF', F: '#6E523F' },
  marks: [
    [5, 1, 1, 1, 'B'],
    [15, 6, 1, 1, '#2E2018'],
  ] as const,
}

describe('characterOf', () => {
  const ana = { id: ANA, character: null }

  it('draws everyone as their default while characters are turned off, and as their own again after', () => {
    expect(characterOf({ ...ana, character: OTTER }, false)).toBe(characterForMember(ana))
    expect(characterOf({ ...ana, character: OTTER }, true)).toBe(OTTER)
  })

  it('draws a member with no saved character as a default that is not Pip, and the same one every time', () => {
    const drawn = characterOf(ana, true)
    expect(isPipLook(drawn)).toBe(false)
    expect(drawn).toBe(characterOf(ana, true))
    expect(drawn).toBe(characterForMember(ana))
  })

  it('draws a stored copy of Pip as no character, and an unknown member as a default too', () => {
    expect(isPipLook(characterOf({ ...ana, character: PIGEON }, true))).toBe(false)
    expect(characterOf({ ...ana, character: PIGEON }, true)).toBe(characterOf(ana, true))
    expect(isPipLook(characterOf(undefined, true))).toBe(false)
  })

  it('never draws a person as Pip, whoever they are', () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (id, on) => {
        expect(isPipLook(characterOf({ id: id as MemberId, character: null }, on))).toBe(false)
      }),
    )
  })

  it('draws a channel’s agent with no saved character as the robot, unless characters are off', () => {
    expect(characterOf({ ...ana, kind: 'channel_agent' }, true)).toBe(ROBOT)
    expect(ROBOT.id).toBe('robot')
    expect(characterOf({ ...ana, character: OTTER, kind: 'channel_agent' }, true)).toBe(OTTER)
    expect(characterOf({ ...ana, kind: 'channel_agent' }, false)).not.toBe(ROBOT)
    expect(characterOf({ ...ana, kind: 'person' }, true)).toBe(characterForMember(ana))
  })
})

describe('hasSavedCharacter', () => {
  it('is true for a character of one’s own and false for none or Pip’s look', () => {
    expect(hasSavedCharacter({ character: OTTER })).toBe(true)
    expect(hasSavedCharacter({ character: null })).toBe(false)
    expect(hasSavedCharacter({ character: PIGEON })).toBe(false)
  })
})

describe('framePixels', () => {
  it('draws a 16 by 17 cell frame at a whole-number scale, with the character’s own colors', () => {
    const pixels = framePixels(OTTER, 'idle', 0, 2)
    expect([pixels.width, pixels.height]).toEqual([32, 34])
    const at = (x: number, y: number) => [...pixels.data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)]
    expect(at(0, 0)).toEqual([0, 0, 0, 0])
    expect(at(14, 16)).toEqual([0x8a, 0x6a, 0x52, 255])
  })

  it('returns the same pixels for the same frame, and wraps a frame number past the last', () => {
    expect(framePixels(OTTER, 'idle', 0, 1)).toBe(framePixels(OTTER, 'idle', 0, 1))
    expect(framePixels(OTTER, 'idle', 4, 1).data).toEqual(framePixels(OTTER, 'idle', 0, 1).data)
    expect(framePixels(OTTER, 'idle', 1, 1).data).not.toEqual(framePixels(OTTER, 'idle', 0, 1).data)
  })

  it('keeps drawing correctly once its cache is full', () => {
    for (let scale = 1; scale <= 3; scale++)
      for (const preset of PRESETS)
        for (let index = 0; index < 30; index++) framePixels(preset, 'celebrate', index, scale)
    expect(framePixels(OTTER, 'sending', 0, 1).width).toBe(16)
  })

  it('knows how long every frame of a state shows', () => {
    expect(frameTimings(OTTER, 'idle')).toEqual([1400, 140, 900, 140])
    expect(PREVIEW_STATES[0]).toBe('idle')
  })
})

describe('builtInIdOf', () => {
  it('recognises a built-in character only while it is unchanged', () => {
    expect(builtInIdOf(presetById('fox')!)).toBe('fox')
    expect(builtInIdOf({ ...presetById('fox')!, name: 'Foxy' })).toBeNull()
    expect(builtInIdOf(OTTER)).toBeNull()
  })
})

describe('the editor workbench', () => {
  it('starts the pigeon, and a member without a character, from a blank editor that passes', () => {
    const blank = workbenchFor(PIGEON)
    expect(blank.layer).toBeNull()
    expect(problemsOf(blank)).toEqual([])
  })

  it('starts a built-in character with its markings as a layer, under an id of the person’s own', () => {
    const cat = workbenchFor(presetById('cat')!)
    expect(cat.layer).toEqual({
      source: 'built-in',
      marks: presetById('cat')!.marks,
      kept: true,
      builtIn: 'cat',
    })
    expect(cat.editor.extra).toEqual([])
    expect(specOf(cat).id).toBe('my-cat')
    expect(specOf(cat).marks).toEqual(presetById('cat')!.marks)
    expect(problemsOf(cat)).toEqual([])
  })

  it('opens every built-in character in the editor so that it passes as it is', () => {
    for (const preset of PRESETS)
      expect([preset.id, problemsOf(workbenchFromBuiltIn(preset.id)!)]).toEqual([preset.id, []])
    expect(workbenchFromBuiltIn('unicorn')).toBeNull()
    expect(workbenchFromBuiltIn('frog')!.layer?.source).toBe('built-in')
  })

  it('opens a saved character with its markings as the saved layer', () => {
    const saved = workbenchFor(OTTER)
    expect(saved.layer?.source).toBe('saved')
    expect(specOf(saved)).toMatchObject({ id: 'my-otter', name: 'Otter', marks: OTTER.marks })
  })

  it('loads an agent’s draft from a link as a layer the person can remove, and nothing from a bad link', () => {
    const draft = workbenchFromLink(encodeCharacter(OTTER))!
    expect(draft.layer?.source).toBe('agent')
    expect(specOf(draft).marks).toEqual(OTTER.marks)
    const removed = { ...draft, layer: { ...draft.layer!, kept: false } }
    expect(specOf(removed).marks).toEqual([])
    expect(editorStateOf(removed).extra).toEqual([])
    expect(workbenchFromLink('not a link')).toBeNull()
    expect(workbenchFromLink(encodeCharacter({ ...OTTER, marks: [] }))!.layer).toBeNull()
  })

  it('never saves something that fails: problems come from the same rules as the server', () => {
    const draft = workbenchFromLink(encodeCharacter({ ...OTTER, id: 'cat' }))!
    expect(problemsOf(draft)).toEqual(characterProblems({ ...specOf(draft) }))
    expect(problemsOf(draft)).toHaveLength(1)
  })

  it('makes a passing character every time Surprise me is pressed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (seed) => {
        const made = surprise(seed)
        expect(problemsOf(made)).toEqual([])
        expect(surprise(seed)).toEqual(made)
      }),
      { numRuns: 20 },
    )
  })
})

describe('blockedParts', () => {
  it('blocks a part only for the rules picking it would newly break, never the part already picked', () => {
    const otter = workbenchFor(OTTER)
    const blocked = blockedParts(otter)
    for (const slot of SLOTS) expect(blocked[slot.id][otter.editor.parts[slot.id]]).toEqual([])
    const withUnder = blockedParts({
      ...otter,
      editor: { ...otter.editor, parts: { ...otter.editor.parts, under: 'tentacles' } },
    })
    expect(withUnder.under.tentacles).toEqual([])
  })

  it('names the rule a blocked part would break', () => {
    const otter = workbenchFor(OTTER)
    const spiky = {
      ...otter,
      editor: { ...otter.editor, parts: { ...otter.editor.parts, spikes: 'all-round' } },
    }
    expect(blockedParts(spiky).nose.bill).toEqual([])
    const reasons = blockedParts(otter).spikes
    const blocked = Object.entries(reasons).filter(([, why]) => why.length > 0)
    for (const [, why] of blocked) for (const reason of why) expect(problemKindOf(reason)).not.toBe('')
    expect(Object.keys(reasons)).toEqual(['none', 'back', 'quills', 'all-round'])
  })

  it('does not block every part just because the character already breaks a rule', () => {
    const faint = workbenchFor({ ...OTTER, palette: { ...OTTER.palette, B: '#F2F5FA', D: '#F2F5FA' } })
    expect(problemsOf(faint).length).toBeGreaterThan(0)
    expect(blockedParts(faint).pattern.belly).toEqual([])
  })
})

describe('renamed', () => {
  it('gives the character an id made from its name that no built-in character has', () => {
    const named = renamed(workbenchFor(PIGEON), 'Sleepy Otter')
    expect(specOf(named)).toMatchObject({ name: 'Sleepy Otter', id: 'my-sleepy-otter' })
    for (const preset of BUILT_IN_CHARACTERS) expect(idFrom(preset.name)).not.toBe(preset.id)
  })

  it('makes a valid id from any name, in any script', () => {
    expect(idFrom('수달')).toBe('my-character')
    expect(idFrom('  Ünïcode -- Fox!! ')).toBe('my-unicode-fox')
    expect(idFrom('x'.repeat(40))).toBe(`my-${'x'.repeat(29)}`)
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (name) => {
        expect(idFrom(name)).toMatch(/^my-[a-z0-9][a-z0-9-]{0,28}$|^my-character$/)
        expect(idFrom(name).endsWith('-')).toBe(false)
      }),
    )
  })
})

describe('problemKindOf', () => {
  it('sorts every problem the rules can report into a kind people can read in their language', () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [{ ...OTTER, name: '' }, 'nameLength'],
      [{ ...OTTER, name: 'Pip Two' }, 'nameWords'],
      [{ ...PIGEON, id: 'my-pigeon' }, 'copiesPip'],
      [{ ...OTTER, id: 'cat' }, 'builtInId'],
      [{ ...OTTER, marks: [[0, 0, 16, 6, 'B']] }, 'tooManyCells'],
      [{ ...OTTER, marks: [[12, 9, 1, 1, 'B']] }, 'mouth'],
      [{ ...OTTER, marks: [[13, 1, 1, 1, 'B']] }, 'iconCorner'],
      [{ ...OTTER, marks: [[5, 14, 1, 1, 'B']] }, 'needsNoFeet'],
      [{ ...OTTER, palette: { ...OTTER.palette, B: '#FFD879' } }, 'systemColor'],
      [{ ...OTTER, palette: { ...OTTER.palette, K: '#8A6A52' } }, 'eyeContrast'],
      [{ ...OTTER, palette: { B: '#F2F5FA', D: '#F2F5FA', O: '#F2F5FA', F: '#F2F5FA' } }, 'faintOnLight'],
      [
        { ...OTTER, palette: { B: '#22324E', D: '#22324E', O: '#22324E', F: '#22324E', K: '#FFFFFF' } },
        'faintOnDark',
      ],
      [{ ...OTTER, version: 2 }, 'format'],
    ]
    for (const [spec, kind] of cases)
      expect([kind, characterProblems(spec).map(problemKindOf)]).toEqual([
        kind,
        expect.arrayContaining([kind]),
      ])
    expect(problemKindOf('3 mark cells sit outside the body; the limit is 16')).toBe('tooManyOutside')
    expect(
      problemKindOf('marks outside the body must touch the outline or sit in the ears/tail/under zones'),
    ).toBe('stray')
    expect(problemKindOf('12 spike cells along the outline; the limit is 10')).toBe('tooManySpikes')
    expect(problemKindOf('9 colors; the limit is 8')).toBe('tooManyColors')
    expect(problemKindOf('something new')).toBe('format')
    expect(new Set(PROBLEM_KIND_NAMES).size).toBe(17)
  })
})

describe('character words', () => {
  it('names every part, every slot and every built-in character in each language', async () => {
    const { LANGUAGES } = await import('../src/languages.ts')
    for (const language of Object.values(LANGUAGES)) {
      const words = language.character
      for (const slot of SLOTS) {
        expect(words.slots[slot.id]).toBeTruthy()
        for (const option of slot.options)
          expect([slot.id, option.id, (words.options[slot.id] as Record<string, string>)[option.id]]).toEqual(
            [slot.id, option.id, expect.any(String)],
          )
        expect(Object.keys(words.options[slot.id])).toHaveLength(slot.options.length)
      }
      for (const preset of PRESETS) expect((words.names as Record<string, string>)[preset.id]).toBeTruthy()
      for (const kind of PROBLEM_KIND_NAMES) expect(words.problems[kind]).toBeTruthy()
    }
  })

  it('uses the English part labels of the editor parts', async () => {
    const { en } = await import('../src/languages/en.ts')
    for (const slot of SLOTS)
      for (const option of slot.options)
        expect((en.character.options[slot.id] as Record<string, string>)[option.id]).toBe(option.label)
  })
})
