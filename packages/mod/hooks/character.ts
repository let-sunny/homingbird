import type { ToolSpec } from 'claude-code'

import {
  BUILT_IN_CHARACTERS,
  type CharacterSpec,
  characterLink,
  characterProblems,
} from './character-rules.mjs'

/**
 * The tools that help a person make their profile character. They check and preview and call nothing:
 * no command, no route. Only the person saves a character, by pressing "Use this character" in the web
 * client (security rule 7).
 */
export const CHARACTER_TOOLS = {
  check: {
    name: 'check_character',
    description:
      'Check a Homingbird profile character (a CharacterSpec) against every rule. Returns the problems to fix, or that it passes. It saves nothing.',
    inputSchema: characterInput(),
  },
  preview: {
    name: 'preview_character',
    description:
      'Check a profile character and, when it passes, return the link that opens it in the Homingbird character editor for the person to review. Show them the link. It saves nothing; only the person can, with "Use this character".',
    inputSchema: characterInput(),
  },
} as const satisfies Readonly<Record<string, ToolSpec>>

export const checkCharacter = (input: Readonly<Record<string, unknown>>): string => {
  const character = specIn(input.character)
  const problems = characterProblems(character)
  return problems.length > 0
    ? problemsText(problems)
    : `passes: ${describe(character as CharacterSpec)} Show it with preview_character. ${SAVED_ONLY_BY_A_PERSON}`
}

export const previewCharacter = (input: Readonly<Record<string, unknown>>, webClientUrl: string): string => {
  const character = specIn(input.character)
  const problems = characterProblems(character)
  if (problems.length > 0) return problemsText(problems)
  const spec = character as CharacterSpec
  if (webClientUrl === '')
    return `Checked ${describe(spec)} Homingbird is not signed in here, so there is no link; the person can open the character editor under Profile, My character. ${SAVED_ONLY_BY_A_PERSON}`
  return [
    `Checked ${describe(spec)}`,
    `Show this link to the person: ${characterLink(webClientUrl, spec)}`,
    `It opens the character editor with your draft as a layer they can keep or remove. ${SAVED_ONLY_BY_A_PERSON}`,
  ].join('\n')
}

/** What `/homingbird character` asks the session's model to do, following the make-character skill. */
export const characterPromptFor = (idea: string): string =>
  [
    'Help me make my Homingbird profile character: a small animal drawn on Pip’s 16x16 bubble body. You draft; I decide.',
    idea === ''
      ? 'First ask me, in one or two short questions, what I would like: an animal or creature, one or two colors, and one detail such as ears, a tail tip, spots or an antenna.'
      : `I have this in mind: ${idea}. Ask at most one short question if something important is missing.`,
    'Then write a CharacterSpec, starting from the closest built-in character below, with an id of your own (never a built-in id) and a name of 1 to 20 characters without Claude, Anthropic, Homingbird or Pip.',
    'Check it with check_character; fix every problem and check again. Never show me a character that fails.',
    'When it passes, call preview_character and show me the link: it opens the character editor, and I press "Use this character" there if I like it.',
    'Ask what to change and repeat. Keep replies plain and short.',
    RULES,
    SAVED_ONLY_BY_A_PERSON,
    `Built-in characters, one CharacterSpec per line:\n${BUILT_IN_CHARACTERS.map((preset) => JSON.stringify(preset)).join('\n')}`,
  ].join('\n\n')

export const SAVED_ONLY_BY_A_PERSON =
  'You cannot save a character, and no tool can: the person saves it by pressing "Use this character" in Homingbird. Never say a character was saved.'

function characterInput() {
  return {
    type: 'object',
    properties: {
      character: {
        type: 'object',
        description:
          'The CharacterSpec: version 1, base "bubble-16", id, name, palette (B body, D wing, O beak, F feet, K eye), optional noFeet, and marks as [x, y, w, h, color].',
      },
    },
    required: ['character'],
    additionalProperties: false,
  }
}

const specIn = (character: unknown): unknown => {
  if (typeof character !== 'string') return character
  try {
    return JSON.parse(character)
  } catch {
    return character
  }
}

const problemsText = (problems: ReadonlyArray<string>): string =>
  [
    `${problems.length} problem(s). Fix each one and check again; do not show the person a character that fails:`,
    ...problems.map((problem) => `- ${problem}`),
  ].join('\n')

const describe = (spec: CharacterSpec): string => {
  const colors = (['B', 'D', 'O', 'F', 'K'] as const)
    .filter((key) => spec.palette[key] !== undefined)
    .map((key) => `${PART_NAMES[key]} ${spec.palette[key]}`)
  return `${JSON.stringify(spec.name)} (${spec.id}): ${colors.length > 0 ? colors.join(', ') : 'Pip’s colors'}; ${spec.marks.length} marking(s); ${spec.noFeet === true ? 'no feet' : 'with feet'}. It meets every rule: the format, the zones, at most 8 colors and 80 marked cells, the eye contrast, visibility on light and dark, the name, and that it neither copies Pip nor takes a built-in id.`
}

const PART_NAMES = { B: 'body', D: 'wing', O: 'beak', F: 'feet', K: 'eye' } as const

const RULES = [
  'The format: palette keys are B body, D wing, O beak or muzzle, F feet, K eye; missing keys use Pip’s colors. A mark is [x, y, w, h, color] in whole cells of the 16x16 grid, x 0-15 left to right, y 0-15 top to bottom; color is #RRGGBB or one of B, D, O, F, K. noFeet: true is for swimmers and floaters.',
  'The map: the body fills rows 2-14, the eye is at x 11, y 5-6, the beak at (14,6), (15,6), (14,7). Markings may go anywhere inside the body except the mouth zone (x 11-15, y 8-11). Outside the body only on the head top (x 2-11, y 0-2), the tail (x 0-2, y 11-15), underneath (x 3-13, y 13-15, with noFeet) or as single spikes touching the outline (10 at most); never in the top-right corner (x 12-15, y 0-4).',
  'The limits: 8 colors, 80 marked cells, 16 of them outside the body; the eye 3:1 against what is behind it; half the outline must stand out on #F2F5FA and on #22324E; the body clear of the envelope yellow, alert red and sparkle teal; do not copy Pip’s colors.',
  'Taste: flat colors, few of them. No text, logos, flags or symbols in the pixels, no real people, no other companies’ mascots or characters from games, films or shows, nothing offensive.',
].join(' ')
