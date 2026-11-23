import { CharacterSpec, PRESETS, validateCharacter } from '@homingbird/sprites'
import { isPipLook } from './pip-look.ts'

/**
 * Everything Dovecote refuses in a profile character: the brand rules, plus a made character that takes a
 * built-in character's id. Clients and tools call it for feedback; the server calls it again before saving.
 */
export const characterProblems = (input: unknown): string[] => {
  const problems = isPipLook(input) ? [PIP_IS_THE_BRAND] : validateCharacter(input)
  const builtIn = PRESETS.find((preset) => preset.id === idOf(input))
  if (builtIn === undefined || isSameCharacter(input, builtIn)) return problems
  return [
    ...problems,
    `id: "${builtIn.id}" belongs to a built-in character; give your own character another id`,
  ]
}

export { CharacterSpec }
export { isPipLook } from './pip-look.ts'

const PIP_IS_THE_BRAND = 'palette: B, D and O all match Pip; Pip is the brand, make it your own'

export const characterForMember = (member: {
  readonly id: string
  readonly character: CharacterSpec | null
}): CharacterSpec =>
  member.character !== null && !isPipLook(member.character)
    ? member.character
    : DEFAULT_CHARACTERS[hashOf(member.id) % DEFAULT_CHARACTERS.length]!

export const CHOOSABLE_CHARACTERS: ReadonlyArray<CharacterSpec> = PRESETS.filter(
  (preset) => !isPipLook(preset),
)

export const DEFAULT_CHARACTERS: ReadonlyArray<CharacterSpec> = CHOOSABLE_CHARACTERS.filter(
  (preset) => preset.id !== 'robot',
)

export const BUILT_IN_CHARACTERS: ReadonlyArray<CharacterSpec> = PRESETS

export const CHARACTER_BYTES_MAX = 4096

export const builtInCharacterOf = (spec: CharacterSpec): CharacterSpec | undefined =>
  PRESETS.find((preset) => isSameCharacter(spec, preset))

export const isSameCharacter = (a: unknown, b: unknown): boolean => {
  const first = canonical(a)
  return first !== null && first === canonical(b)
}

const hashOf = (text: string): number => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

const idOf = (input: unknown): unknown =>
  typeof input === 'object' && input !== null ? (input as { readonly id?: unknown }).id : undefined

const canonical = (input: unknown): string | null => {
  const decoded = CharacterSpec.decode(input)
  if (decoded._tag === 'Err') return null
  const spec = decoded.value
  return JSON.stringify([
    spec.id,
    spec.name,
    Object.entries(spec.palette)
      .map(([key, color]) => `${key}${String(color).toUpperCase()}`)
      .sort(),
    spec.noFeet === true,
    spec.marks.map(([x, y, w, h, color]) => [x, y, w, h, color.toUpperCase()]),
  ])
}
