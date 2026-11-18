import { Task as T } from '@homingbird/kernel'
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
  readonly text: (given: Readonly<Record<string, string>>) => string
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
        'For each note that is waiting, draft a reply with draft_reply, using what you know from this session.',
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
        'Call wait_for_notes. When it returns notes, draft a reply to each with draft_reply, tell me in one line what you drafted, and call wait_for_notes again. When it returns nothing, call it again.',
        NOTHING_IS_SENT,
      ].join(' '),
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
  return T.succeed({
    description: found.description,
    messages: [{ role: 'user', content: { type: 'text', text: found.text(values) } }],
  })
}

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
