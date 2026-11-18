import { CharacterSpec, PRESETS, validateCharacter } from '@homingbird/sprites'

/**
 * Everything Dovecote refuses in a profile character, in words a person or a model can act on: the brand
 * rules of `validateCharacter`, plus a made character that takes a built-in character's id. Clients and
 * model-facing tools call it for feedback; the server calls it again before it saves, and never trusts a
 * client's check.
 */
export const characterProblems = (input: unknown): string[] => {
  const problems = validateCharacter(input)
  const builtIn = PRESETS.find((preset) => preset.id === idOf(input))
  if (builtIn === undefined || isSameCharacter(input, builtIn)) return problems
  return [
    ...problems,
    `id: "${builtIn.id}" belongs to a built-in character; give your own character another id`,
  ]
}

export { CharacterSpec }

/** A character travels as JSON well under this; anything larger is refused before it is read. */
export const CHARACTER_BYTES_MAX = 4096

/** The built-in character a spec is, unchanged, or undefined for a character someone made. */
export const builtInCharacterOf = (spec: CharacterSpec): CharacterSpec | undefined =>
  PRESETS.find((preset) => isSameCharacter(spec, preset))

export const isSameCharacter = (a: unknown, b: unknown): boolean => {
  const first = canonical(a)
  return first !== null && first === canonical(b)
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
