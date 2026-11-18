import { Schema as S, Task as T } from '@homingbird/kernel'
import { CharacterSpec, characterLink, characterProblems } from '@homingbird/protocol'
import type { Tool } from './tools.ts'

/**
 * Tools that help a person make their profile character. They check and preview, and nothing else: they
 * call no route at all, so no model can save or change a character (security rule 7). The person saves
 * it by pressing "Use this character" in the web client.
 */
export const CHARACTER_TOOLS: ReadonlyArray<Tool<{ readonly character: S.Schema<unknown> }>> = [
  {
    name: 'check_character',
    title: 'Check a profile character',
    description:
      'Checks a Homingbird profile character (a CharacterSpec) against every rule and returns the problems to fix, or that it passes. It saves nothing.',
    readOnly: true,
    input: { character: characterInput() },
    describe: { character: characterField() },
    run: ({ character }) => T.succeed(checked(specIn(character))),
  },
  {
    name: 'preview_character',
    title: 'Preview a profile character',
    description:
      'Checks a profile character and, when it passes, returns a link that opens it in the Homingbird character editor for your human to review. Show your human the link. It saves nothing; only your human can, by pressing "Use this character".',
    readOnly: true,
    input: { character: characterInput() },
    describe: { character: characterField() },
    run: ({ character }, { webClientUrl }) => T.succeed(previewed(specIn(character), webClientUrl)),
  },
]

export const CHARACTER_SAVED_ONLY_BY_A_PERSON =
  'You cannot save a character, and no tool can: your human saves it by pressing "Use this character" in Homingbird. Never say a character was saved.'

function characterField(): string {
  return 'The CharacterSpec as a JSON object: version 1, base "bubble-16", id, name, palette (B body, D wing, O beak, F feet, K eye), optional noFeet, and marks as [x, y, w, h, color].'
}

const WHAT_WAS_CHECKED =
  'the format, the zones where markings may go, at most 8 colors and 80 marked cells, the eye contrast, visibility on the light and dark backgrounds, the name, and that it neither copies Pip nor takes a built-in character’s id'

function characterInput(): S.Schema<unknown> {
  // The model sees the full CharacterSpec schema, but anything is accepted here, so that every problem
  // comes back in the words of the character rules rather than as a schema error.
  return { ...S.unknown, ast: CharacterSpec.ast }
}

const specIn = (character: unknown): unknown => {
  if (typeof character !== 'string') return character
  try {
    return JSON.parse(character)
  } catch {
    return character
  }
}

const checked = (character: unknown): string => {
  const problems = characterProblems(character)
  return problems.length > 0
    ? problemsText(problems)
    : `passes: ${describeCharacter(character as CharacterSpec)} It meets every rule: ${WHAT_WAS_CHECKED}. Show it to your human with preview_character. ${CHARACTER_SAVED_ONLY_BY_A_PERSON}`
}

const previewed = (character: unknown, webClientUrl: string | null): string => {
  const problems = characterProblems(character)
  if (problems.length > 0) return problemsText(problems)
  const spec = character as CharacterSpec
  const checkedText = `Checked ${describeCharacter(spec)} It meets every rule: ${WHAT_WAS_CHECKED}.`
  if (webClientUrl === null)
    return `${checkedText} The address of the Homingbird web client is not known here, so there is no link; your human can open the character editor under Profile, My character. ${CHARACTER_SAVED_ONLY_BY_A_PERSON}`
  return [
    checkedText,
    `Show this link to your human: ${characterLink(webClientUrl, spec)}`,
    `It opens the character editor with your draft as a layer they can keep or remove. ${CHARACTER_SAVED_ONLY_BY_A_PERSON}`,
  ].join('\n')
}

const problemsText = (problems: ReadonlyArray<string>): string =>
  [
    `${problems.length} problem(s). Fix each one and check again; do not show your human a character that fails:`,
    ...problems.map((problem) => `- ${problem}`),
  ].join('\n')

const describeCharacter = (spec: CharacterSpec): string => {
  const colors = (['B', 'D', 'O', 'F', 'K'] as const)
    .filter((key) => spec.palette[key] !== undefined)
    .map((key) => `${PART_NAMES[key]} ${spec.palette[key]}`)
  const cells = new Set(
    spec.marks.flatMap(([x, y, w, h]) =>
      Array.from({ length: w * h }, (_, index) => `${x + (index % w)},${y + Math.floor(index / w)}`),
    ),
  )
  return `${JSON.stringify(spec.name)} (${spec.id}): ${colors.length > 0 ? colors.join(', ') : 'Pip’s colors'}; ${spec.marks.length} marking(s) over ${cells.size} cell(s); ${spec.noFeet === true ? 'no feet' : 'with feet'}.`
}

const PART_NAMES = { B: 'body', D: 'wing', O: 'beak', F: 'feet', K: 'eye' } as const
