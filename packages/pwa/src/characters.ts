import {
  BUILT_IN_CHARACTERS,
  type CharacterSpec,
  type Member,
  builtInCharacterOf,
  characterProblems,
  decodeCharacter,
} from '@homingbird/protocol'
import {
  type EditorState,
  type Pixels,
  type Rect,
  SLOTS,
  type SlotId,
  type StateName,
  choicesFor,
  composeCharacter,
  editorFromPreset,
  editorFromSpec,
  emptyEditor,
  randomCharacter,
  renderFrame,
  statesFor,
} from '@homingbird/sprites'
import { featureOn } from './features.ts'

/** The character a member is drawn as: the one they saved, or the pigeon. */
export const characterOf = (member: Pick<Member, 'character'> | undefined): CharacterSpec =>
  (featureOn('characters') ? member?.character : null) ?? PIGEON

export const PIGEON: CharacterSpec = BUILT_IN_CHARACTERS[0]!

/** One frame of a character in a state, at a whole-number scale, ready for `ImageData`. */
export const framePixels = (spec: CharacterSpec, state: StateName, index: number, scale: number): Pixels => {
  const key = JSON.stringify([spec, state, index, scale])
  const cached = PIXELS.get(key)
  if (cached !== undefined) return cached
  const frames = framesOf(spec)[state]
  const pixels = renderFrame(frames[index % frames.length]!, scale, { ...spec.palette })
  if (PIXELS.size >= PIXELS_CACHED) PIXELS.delete(PIXELS.keys().next().value!)
  PIXELS.set(key, pixels)
  return pixels
}

/** How long each frame of a state shows, in milliseconds. */
export const frameTimings = (spec: CharacterSpec, state: StateName): number[] =>
  framesOf(spec)[state].map((frame) => frame.ms)

/** The id of the built-in character a spec is, unchanged, or null for one someone made. */
export const builtInIdOf = (spec: CharacterSpec): string | null => builtInCharacterOf(spec)?.id ?? null

/** The states a preview shows: idle first, then the moments a colleague sees most. */
export const PREVIEW_STATES = [
  'idle',
  'sending',
  'new-note',
  'awaiting-approval',
] as const satisfies ReadonlyArray<StateName>

export type PreviewState = (typeof PREVIEW_STATES)[number]

/**
 * What the editor works on: the parts and colors, plus one layer of markings that came from a built-in
 * character, the saved character or an agent's draft. The person keeps or removes that layer as a whole.
 */
export interface Workbench {
  readonly editor: EditorState
  readonly layer: Layer | null
}

export interface Layer {
  readonly source: 'built-in' | 'saved' | 'agent'
  readonly marks: ReadonlyArray<Rect>
  readonly kept: boolean
  readonly builtIn: string | null
}

export const workbenchFor = (current: CharacterSpec): Workbench => {
  const builtIn = builtInIdOf(current)
  if (builtIn === 'pigeon') return { editor: emptyEditor(), layer: null }
  if (builtIn !== null) return workbenchFromBuiltIn(builtIn)!
  return withLayer(editorFromSpec(current), 'saved')
}

export const workbenchFromBuiltIn = (id: string): Workbench | null => {
  if (id === PIGEON.id) return { editor: emptyEditor(), layer: null }
  const editor = editorFromPreset(id)
  return editor === undefined ? null : withLayer(editor, 'built-in', id)
}

/** An agent's draft from a link; null when the link holds no character. Nothing is saved from a link. */
export const workbenchFromLink = (encoded: string): Workbench | null => {
  const spec = decodeCharacter(encoded)
  return spec === null ? null : withLayer(editorFromSpec(spec), 'agent')
}

export const surprise = (seed: number): Workbench => ({ editor: randomCharacter(seed), layer: null })

export const editorStateOf = (workbench: Workbench): EditorState => ({
  ...workbench.editor,
  extra: workbench.layer?.kept === true ? workbench.layer.marks : [],
})

export const specOf = (workbench: Workbench): CharacterSpec => composeCharacter(editorStateOf(workbench))

export const problemsOf = (workbench: Workbench): string[] => characterProblems(specOf(workbench))

/**
 * For every part of every slot, the problems picking it would add to what is already wrong. Empty means
 * it can be picked; the part already picked is never blocked.
 */
export const blockedParts = (workbench: Workbench): Record<SlotId, Record<string, string[]>> => {
  const state = editorStateOf(workbench)
  const already = new Set(problemsOf(workbench))
  const choices = choicesFor(state)
  return Object.fromEntries(
    SLOTS.map((slot) => [
      slot.id,
      Object.fromEntries(
        slot.options.map((option) => [
          option.id,
          option.id === state.parts[slot.id]
            ? []
            : choices[slot.id][option.id]!.filter((problem) => !already.has(problem)),
        ]),
      ),
    ]),
  ) as Record<SlotId, Record<string, string[]>>
}

/** A new name, and an id made from it that can never be a built-in character's. */
export const renamed = (workbench: Workbench, name: string): Workbench => ({
  ...workbench,
  editor: { ...workbench.editor, name, id: idFrom(name) },
})

export const idFrom = (name: string): string => {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 29)
    .replace(/-+$/, '')
  return slug === '' ? 'my-character' : `my-${slug}`
}

/** The kind of rule a problem breaks, so that people read it in their own language. */
export const problemKindOf = (problem: string): ProblemKind =>
  PROBLEM_KINDS.find(([, pattern]) => pattern.test(problem))?.[0] ?? 'format'

export type ProblemKind =
  | 'format'
  | 'nameLength'
  | 'nameWords'
  | 'copiesPip'
  | 'builtInId'
  | 'tooManyCells'
  | 'tooManyOutside'
  | 'iconCorner'
  | 'mouth'
  | 'needsNoFeet'
  | 'stray'
  | 'tooManySpikes'
  | 'tooManyColors'
  | 'systemColor'
  | 'eyeContrast'
  | 'faintOnLight'
  | 'faintOnDark'

export const PROBLEM_KIND_NAMES: ReadonlyArray<ProblemKind> = [
  'format',
  'nameLength',
  'nameWords',
  'copiesPip',
  'builtInId',
  'tooManyCells',
  'tooManyOutside',
  'iconCorner',
  'mouth',
  'needsNoFeet',
  'stray',
  'tooManySpikes',
  'tooManyColors',
  'systemColor',
  'eyeContrast',
  'faintOnLight',
  'faintOnDark',
]

const PROBLEM_KINDS: ReadonlyArray<readonly [ProblemKind, RegExp]> = [
  ['nameLength', /^name: 1-/],
  ['nameWords', /^name: may not contain/],
  ['copiesPip', /all match Pip/],
  ['builtInId', /belongs to a built-in character/],
  ['tooManyCells', /^marks cover \d+ cells/],
  ['tooManyOutside', /mark cells sit outside the body/],
  ['iconCorner', /top-right corner/],
  ['mouth', /below the beak/],
  ['needsNoFeet', /need "noFeet"/],
  ['stray', /must touch the outline/],
  ['tooManySpikes', /spike cells along the outline/],
  ['tooManyColors', /^\d+ colors; the limit/],
  ['systemColor', /is too close to the/],
  ['eyeContrast', /^eye .* contrast/],
  ['faintOnLight', /^too faint on Mist/],
  ['faintOnDark', /^too faint on Night/],
]

const withLayer = (
  editor: EditorState,
  source: Layer['source'],
  builtIn: string | null = null,
): Workbench => ({
  editor: { ...editor, extra: [] },
  layer: editor.extra.length === 0 ? null : { source, marks: editor.extra, kept: true, builtIn },
})

const framesOf = (spec: CharacterSpec) => {
  const key = JSON.stringify(spec)
  const cached = STATES.get(key)
  if (cached !== undefined) return cached
  const states = statesFor(spec)
  if (STATES.size >= STATES_CACHED) STATES.delete(STATES.keys().next().value!)
  STATES.set(key, states)
  return states
}

const PIXELS = new Map<string, Pixels>()
const PIXELS_CACHED = 2000
const STATES = new Map<string, ReturnType<typeof statesFor>>()
const STATES_CACHED = 600
