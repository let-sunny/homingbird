import type { CharacterSpec, PaletteKey } from './character-spec.ts'
import { contrast } from './color.ts'
import { COLORS, type Rect } from './grid.ts'
import { presetById } from './presets.ts'
import { validateCharacter } from './rules.ts'

/**
 * The character editor: ready-made parts in slots, two marking colors, and a layer for markings that
 * came from a preset or from Claude. Every editor state composes to a plain CharacterSpec.
 */
export const composeCharacter = (state: EditorState): CharacterSpec => {
  const marks: Rect[] = [...state.extra]
  for (const slot of SLOTS)
    for (const [x, y, w, h, color] of optionOf(slot, state.parts[slot.id]).marks)
      marks.push([
        x,
        y,
        w,
        h,
        color === 'marking' ? state.marking : color === 'detail' ? state.detail : color,
      ])
  const palette = { ...state.palette, ...(state.eye === 'auto' && { K: autoEye(marks, state.palette) }) }
  return {
    version: 1,
    base: 'bubble-16',
    id: state.id,
    name: state.name,
    palette,
    ...((state.parts.under !== 'none' || !state.feet) && { noFeet: true }),
    marks,
  }
}

/** For every option of every slot, the rules picking it would break. Empty means safe to pick. */
export const choicesFor = (state: EditorState): Record<SlotId, Record<string, string[]>> =>
  Object.fromEntries(
    SLOTS.map((slot) => [
      slot.id,
      Object.fromEntries(
        slot.options.map((option) => [
          option.id,
          validateCharacter(composeCharacter({ ...state, parts: { ...state.parts, [slot.id]: option.id } })),
        ]),
      ),
    ]),
  ) as Record<SlotId, Record<string, string[]>>

export const emptyEditor = (): EditorState => ({
  id: 'my-character',
  name: 'My character',
  palette: { B: '#A07A55', D: '#7F5D3F', O: '#D9BC9C', F: '#7F5D3F', K: COLORS.K },
  marking: '#6E5440',
  detail: '#2E2018',
  parts: {
    pattern: 'none',
    face: 'none',
    ears: 'none',
    head: 'none',
    spikes: 'none',
    nose: 'none',
    tail: 'none',
    under: 'none',
  },
  feet: true,
  eye: 'auto',
  extra: [],
})

/** Opens any spec in the editor, a preset or Claude's draft; its markings become the extra layer. */
export const editorFromSpec = (spec: CharacterSpec): EditorState => ({
  ...emptyEditor(),
  id: spec.id,
  name: spec.name,
  palette: { B: COLORS.B, D: COLORS.D, O: COLORS.O, F: COLORS.F, K: COLORS.K, ...spec.palette },
  feet: spec.noFeet !== true,
  eye: 'set',
  extra: spec.marks,
})

export const editorFromPreset = (id: string): EditorState | undefined => {
  const preset = presetById(id)
  return preset && { ...editorFromSpec(preset), id: `my-${preset.id}` }
}

export type SlotId = 'pattern' | 'face' | 'ears' | 'head' | 'spikes' | 'nose' | 'tail' | 'under'

export interface EditorState {
  readonly id: string
  readonly name: string
  readonly palette: Readonly<Record<PaletteKey, string>>
  readonly marking: string
  readonly detail: string
  readonly parts: Readonly<Record<SlotId, string>>
  readonly feet: boolean
  readonly eye: 'auto' | 'set'
  readonly extra: ReadonlyArray<Rect>
}

export interface PartOption {
  readonly id: string
  readonly label: string
  readonly marks: ReadonlyArray<Rect>
}

export interface Slot {
  readonly id: SlotId
  readonly label: string
  readonly options: ReadonlyArray<PartOption>
}

/** Slots in drawing order; later slots draw over earlier ones. Part colors may be `marking` or `detail`. */
export const SLOTS: ReadonlyArray<Slot> = [
  slot('pattern', 'Pattern', [
    part('stripes', 'Stripes', [
      [6, 3, 1, 1, 'marking'],
      [8, 3, 1, 2, 'marking'],
    ]),
    part('bands', 'Bands', [
      [4, 3, 1, 9, 'marking'],
      [7, 2, 1, 11, 'marking'],
    ]),
    part('spots', 'Spots', [
      [4, 4, 2, 2, 'marking'],
      [7, 3, 1, 1, 'marking'],
      [7, 6, 1, 1, 'marking'],
      [3, 11, 2, 1, 'marking'],
    ]),
    part('speckles', 'Speckles', dots('marking', [4, 11], [7, 11], [10, 11])),
    part('head-spots', 'Head spots', dots('marking', [6, 3], [8, 4])),
    part('shell', 'Shell', [
      [5, 2, 4, 1, 'marking'],
      [3, 3, 7, 1, 'marking'],
      [2, 4, 8, 6, 'marking'],
      [3, 10, 6, 1, 'marking'],
      [4, 5, 2, 2, 'detail'],
      [7, 4, 2, 2, 'detail'],
      [6, 7, 2, 2, 'detail'],
    ]),
    part('back-fur', 'Back fur', [
      [5, 2, 4, 1, 'marking'],
      [2, 3, 7, 1, 'marking'],
      [1, 4, 7, 7, 'marking'],
    ]),
    part('belly', 'Belly', [[4, 8, 7, 4, 'marking']]),
    part('underside', 'Underside', [[3, 12, 9, 1, 'marking']]),
  ]),
  slot('face', 'Face', [
    part('patch', 'Eye patch', [[10, 4, 3, 4, 'marking']]),
    part('hood', 'Hood', [
      [10, 3, 3, 1, 'marking'],
      [10, 4, 4, 4, 'marking'],
    ]),
    part('mask', 'Mask', [[9, 5, 5, 1, 'marking']]),
  ]),
  slot('ears', 'Ears', [
    part('pointed', 'Pointed', [
      [5, 0, 1, 2, 'B'],
      [6, 1, 1, 1, 'B'],
      [10, 0, 1, 2, 'B'],
      [9, 1, 1, 1, 'B'],
    ]),
    part('pointed-tips', 'Pointed, dark tips', [
      [5, 0, 1, 2, 'B'],
      [6, 1, 1, 1, 'B'],
      [10, 0, 1, 2, 'B'],
      [9, 1, 1, 1, 'B'],
      [5, 0, 1, 1, 'detail'],
      [10, 0, 1, 1, 'detail'],
    ]),
    part('round', 'Round', [
      [4, 1, 2, 2, 'B'],
      [10, 1, 2, 2, 'B'],
    ]),
    part('round-dark', 'Round, dark', [
      [4, 1, 2, 2, 'marking'],
      [10, 1, 2, 2, 'marking'],
    ]),
    part('long', 'Long', [
      [6, 0, 1, 2, 'B'],
      [8, 0, 1, 2, 'B'],
      [6, 1, 1, 1, 'detail'],
      [8, 1, 1, 1, 'detail'],
    ]),
    part('small', 'Small', [
      [5, 1, 2, 1, 'B'],
      [9, 1, 2, 1, 'B'],
      [5, 1, 1, 1, 'detail'],
      [10, 1, 1, 1, 'detail'],
    ]),
    part('floppy', 'Floppy', [
      [6, 2, 3, 1, 'marking'],
      [7, 3, 2, 3, 'marking'],
    ]),
    part('tufts', 'Tufts', [
      [5, 0, 1, 1, 'D'],
      [5, 1, 2, 1, 'D'],
      [10, 0, 1, 1, 'D'],
      [9, 1, 2, 1, 'D'],
    ]),
  ]),
  slot('head', 'On the head', [
    part('crest', 'Crest', [
      [8, 1, 1, 1, 'D'],
      [9, 0, 1, 2, 'D'],
    ]),
    part('antenna', 'Antenna', [
      [8, 0, 1, 2, 'marking'],
      [8, 0, 1, 1, 'detail'],
    ]),
    part('feelers', 'Feelers', [[11, 1, 1, 2, 'marking']]),
    part('spout', 'Spout', [
      [7, 0, 1, 2, 'detail'],
      [6, 0, 1, 1, 'detail'],
      [8, 0, 1, 1, 'detail'],
    ]),
    part('eye-bump', 'Eye bump', [[9, 1, 3, 2, 'B']]),
    part('fin', 'Top fin', [[6, 1, 3, 1, 'D']]),
    part('wool', 'Wool', dots('B', [5, 1], [7, 1], [9, 1])),
  ]),
  slot('spikes', 'Spikes', [
    part('back', 'Along the back', dots('detail', [6, 1], [8, 1], [3, 2], [1, 4], [0, 6], [0, 9])),
    part('quills', 'Quills', dots('marking', [4, 1], [7, 1], [2, 2], [0, 5], [0, 8])),
    part(
      'all-round',
      'All round',
      dots('marking', [5, 1], [8, 1], [11, 2], [1, 4], [0, 7], [0, 10], [13, 12]),
    ),
  ]),
  slot('nose', 'Nose', [
    part('nose', 'Nose', [[15, 6, 1, 1, 'detail']]),
    part('bill', 'Wide bill', [[15, 7, 1, 1, 'O']]),
  ]),
  slot('tail', 'Tail', [
    part('tip', 'Tail tip', [[0, 14, 1, 1, 'detail']]),
    part('fluke', 'Fluke', [[0, 12, 1, 1, 'B']]),
    part('fin', 'Tail fin', [
      [0, 12, 2, 1, 'detail'],
      [0, 13, 3, 1, 'detail'],
      [0, 14, 2, 1, 'detail'],
    ]),
  ]),
  slot('under', 'Underneath (no feet)', [
    part('tentacles', 'Tentacles', [
      [4, 13, 1, 2, 'B'],
      [6, 13, 1, 1, 'B'],
      [8, 13, 1, 2, 'B'],
      [10, 13, 1, 1, 'B'],
      [12, 13, 1, 1, 'B'],
    ]),
    part('belly-fin', 'Belly fin', [[6, 13, 3, 1, 'D']]),
  ]),
]

function slot(id: SlotId, label: string, options: ReadonlyArray<PartOption>): Slot {
  return { id, label, options: [{ id: 'none', label: 'None', marks: [] }, ...options] }
}

function part(id: string, label: string, marks: ReadonlyArray<Rect>): PartOption {
  return { id, label, marks }
}

function dots(color: string, ...cells: ReadonlyArray<readonly [number, number]>): Rect[] {
  return cells.map(([x, y]): Rect => [x, y, 1, 1, color])
}

const optionOf = (slotOfPart: Slot, id: string): PartOption =>
  slotOfPart.options.find((option) => option.id === id) ?? slotOfPart.options[0]!

const autoEye = (marks: ReadonlyArray<Rect>, palette: Readonly<Record<PaletteKey, string>>): string => {
  const behind = EYE_CELLS.map(([x, y]) => {
    const cover = marks.findLast(([mx, my, w, h]) => x >= mx && x < mx + w && y >= my && y < my + h)
    if (cover === undefined) return palette.B
    return cover[4].startsWith('#') ? cover[4] : palette[cover[4] as PaletteKey]
  })
  const weakest = (eye: string) => Math.min(...behind.map((color) => contrast(eye, color)))
  return weakest('#FFFFFF') > weakest(COLORS.K) ? '#FFFFFF' : COLORS.K
}

const EYE_CELLS: ReadonlyArray<readonly [number, number]> = [
  [10, 4],
  [10, 6],
  [11, 5],
  [11, 6],
  [12, 4],
  [12, 6],
]
