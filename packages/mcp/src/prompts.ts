import { Task as T } from '@homingbird/kernel'
import { ANSWER_RULE, BUILT_IN_CHARACTERS, teachingInterviewPrompt } from '@homingbird/protocol'
import { CHARACTER_SAVED_ONLY_BY_A_PERSON } from './character-tools.ts'
import { type RpcFailure, invalidParams } from './json-rpc.ts'

export interface Prompt {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly arguments: ReadonlyArray<{
    readonly name: string
    readonly description: string
    readonly required: boolean
  }>
  /** The message the prompt gives; a task when getting it does something the person chose, such as pausing the desk. */
  readonly text: (given: Readonly<Record<string, string>>) => string | T.Task<string, RpcFailure>
}

export const PROMPTS: ReadonlyArray<Prompt> = [
  {
    name: 'inbox',
    title: 'Check Homingbird',
    description: 'Check the notes colleagues sent and draft a reply to each for you to approve.',
    arguments: [],
    text: () =>
      [
        'Check my Homingbird inbox with check_inbox.',
        'For each note that is waiting, draft a reply with draft_reply, using what you know from this session, or give it back with skip_note and the reason.',
        ANSWER_RULE,
        `Then tell me what you drafted and ${SHOW_THE_LINK}`,
        NOTHING_IS_SENT,
      ].join(' '),
  },
  {
    name: 'ask',
    title: 'Ask a colleague',
    description: 'Draft a note to a colleague for you to approve.',
    arguments: [
      { name: 'who', description: 'The colleague: a name or an email address.', required: true },
      { name: 'what', description: 'What to ask or tell them.', required: true },
    ],
    text: ({ who, what }) =>
      [
        `Draft a Homingbird note to ${who}: ${what}`,
        'Find them with find_people if you need their address, add the context from this session that they will need, and save the note with draft_note.',
        `Then ${SHOW_THE_LINK}`,
        NOTHING_IS_SENT,
      ].join(' '),
  },
  {
    name: 'watch',
    title: 'Watch Homingbird',
    description: 'Keep watching for notes from colleagues and draft a reply to each, until you say stop.',
    arguments: [],
    text: () =>
      [
        'Watch my Homingbird inbox until I tell you to stop.',
        'Call wait_for_notes. When it returns notes, answer each with draft_reply or skip_note, tell me in one line what you drafted or skipped and why, and call wait_for_notes again. When it returns nothing, call it again.',
        ANSWER_RULE,
        NOTHING_IS_SENT,
      ].join(' '),
  },
  {
    name: 'character',
    title: 'Make my character',
    description:
      'Design your Homingbird profile character together: your agent drafts and checks it, and you review it in the editor and save it yourself.',
    arguments: [
      {
        name: 'idea',
        description: 'Optional: the animal, colors or one detail you have in mind.',
        required: false,
      },
    ],
    text: ({ idea }) =>
      [
        'Help me make my Homingbird profile character: a small animal drawn on Pip’s 16x16 bubble body. You draft; I decide.',
        idea === undefined || idea.trim() === ''
          ? 'First ask me, in one or two short questions, what I would like: an animal or creature, one or two colors, and one detail such as ears, a tail tip, spots or an antenna.'
          : `I have this in mind: ${idea.trim()}. Ask at most one short question if something important is missing.`,
        'Then write a CharacterSpec, starting from the closest built-in character below rather than from nothing, and give it an id of your own (not a built-in id) and a name of 1 to 20 characters without Claude, Anthropic, Homingbird or Pip.',
        'Check it with check_character. If it lists problems, fix each one and check again; never show me a character that fails.',
        'When it passes, call preview_character and show me the link it returns: it opens the character editor with your draft, and I press "Use this character" there if I like it.',
        'Ask what to change and repeat. Keep replies plain and short.',
        CHARACTER_RULES,
        CHARACTER_SAVED_ONLY_BY_A_PERSON,
        `Built-in characters, one CharacterSpec per line:\n${BUILT_IN_CHARACTERS.map((preset) => JSON.stringify(preset)).join('\n')}`,
      ].join('\n\n'),
  },
  {
    name: 'teach',
    title: 'Teach my agent',
    description:
      'Teach your agent in a short chat: it asks how you handle kinds of questions, drawing on the document you pasted and the drafts you rewrote, and proposes principles that you save in the web client.',
    arguments: [
      { name: 'topic', description: 'Optional: a kind of question to start with.', required: false },
    ],
    text: ({ topic }) => teachingInterviewPrompt(topic ?? ''),
  },
  {
    name: 'open',
    title: 'Open Homingbird',
    description: 'Open the Homingbird web client, where you approve, edit or discard drafts.',
    arguments: [],
    text: () => `Call open_homingbird and ${SHOW_THE_LINK}`,
  },
]

export const promptDefinitions = (
  prompts: ReadonlyArray<Prompt> = PROMPTS,
): ReadonlyArray<Readonly<Record<string, unknown>>> =>
  prompts.map(({ name, title, description, arguments: expected }) => ({
    name,
    title,
    description,
    arguments: expected,
  }))

export const getPrompt = (
  prompts: ReadonlyArray<Prompt>,
  name: unknown,
  given: unknown,
): T.Task<object, RpcFailure> => {
  const found = prompts.find((each) => each.name === name)
  if (found === undefined) return T.fail(invalidParams(`Unknown prompt: ${String(name)}`))
  const values = stringsIn(given)
  const missing = found.arguments.filter((each) => each.required && (values[each.name] ?? '').trim() === '')
  if (missing.length > 0)
    return T.fail(invalidParams(`Missing required arguments: ${missing.map((each) => each.name).join(', ')}`))
  const text = found.text(values)
  return T.map((said: string) => ({
    description: found.description,
    messages: [{ role: 'user', content: { type: 'text', text: said } }],
  }))(typeof text === 'string' ? T.succeed(text) : text)
}

const CHARACTER_RULES = [
  'The format: palette keys are B body, D wing, O beak or muzzle, F feet, K eye; missing keys use Pip’s colors. A mark is [x, y, w, h, color] in whole cells of the 16x16 grid, x 0-15 left to right and y 0-15 top to bottom; color is #RRGGBB or one of B, D, O, F, K. noFeet: true is for swimmers and floaters.',
  'The map: the body fills rows 2-14, the eye is at x 11, y 5-6, the beak at (14,6), (15,6) and (14,7), the feet at x 6 and 9, y 13-14. Markings may go anywhere inside the body except the mouth zone (x 11-15, y 8-11). Outside the body only on the head top (x 2-11, y 0-2), the tail (x 0-2, y 11-15), underneath (x 3-13, y 13-15, with noFeet) or as single spikes touching the outline (10 at most); never in the top-right corner (x 12-15, y 0-4), where status icons appear. A nose goes at (15, 6).',
  'The limits: 8 colors, 80 marked cells, 16 of them outside the body; the eye needs 3:1 contrast with what is behind it; half the outline must stand out on #F2F5FA and on #22324E; the body color stays clear of the envelope yellow, alert red and sparkle teal; do not copy Pip’s colors.',
  'Taste: flat colors, few of them; one or two markings say more than ten. No text, letters, logos, flags or symbols in the pixels, no real people, no other companies’ mascots or characters from games, films or shows (offer an original animal in a similar spirit instead), nothing offensive.',
].join(' ')

const SHOW_THE_LINK =
  'call open_homingbird and show me the link it returns, so I can approve in the web client.'
const NOTHING_IS_SENT =
  'Do not say anything was sent: nothing leaves until I give my approval in the web client.'

const stringsIn = (given: unknown): Record<string, string> =>
  typeof given === 'object' && given !== null && !Array.isArray(given)
    ? Object.fromEntries(
        Object.entries(given).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    : {}
