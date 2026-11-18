import { Result } from '@homingbird/kernel'
import { CliFailure, EXIT } from './failure.ts'

export type DraftTarget =
  | { readonly kind: 'to'; readonly recipient: string }
  | { readonly kind: 'reply'; readonly noteId: string }
  | { readonly kind: 'conversation'; readonly conversationId: string }
  | { readonly kind: 'topic'; readonly slug: string }
  | { readonly kind: 'request'; readonly requestId: string }

export type Invocation =
  | { readonly command: 'help' }
  | {
      readonly command: 'login'
      readonly server: string
      readonly name: string | null
      readonly approveButton: boolean
      readonly openBrowser: boolean
    }
  | { readonly command: 'logout' }
  | { readonly command: 'status' }
  | { readonly command: 'directory'; readonly query: string | null; readonly topic: string | null }
  | { readonly command: 'topics'; readonly query: string | null }
  | { readonly command: 'requests' }
  | { readonly command: 'open'; readonly conversationId: string | null }
  | { readonly command: 'run'; readonly agent: string; readonly timeoutSeconds: number }
  | { readonly command: 'inbox'; readonly fresh: boolean }
  | { readonly command: 'conversations' }
  | { readonly command: 'conversation'; readonly id: string }
  | { readonly command: 'draft'; readonly target: DraftTarget; readonly text: string }
  | { readonly command: 'drafts' }
  | { readonly command: 'overview' }
  | { readonly command: 'pickup'; readonly noteId: string }
  | { readonly command: 'stream'; readonly after: number | null }
  | { readonly command: 'approve'; readonly draftId: string; readonly body: string | null }
  | { readonly command: 'discard'; readonly draftId: string }

export interface Parsed {
  readonly invocation: Invocation
  readonly json: boolean
}

export const parseArguments = (argv: ReadonlyArray<string>): Result.Result<Parsed, CliFailure> =>
  Result.gen(function* () {
    const { positionals, values, switches } = yield* tokenize(argv)
    const [command, ...rest] = positionals
    const json = switches.has('json')
    if (command === undefined || switches.has('help')) return { invocation: { command: 'help' }, json }
    if (!Object.hasOwn(BUILDERS, command)) return yield* usage(`Unknown command "${command}".`)
    return { invocation: yield* BUILDERS[command]!({ rest, values, switches }), json }
  })

export const USAGE = `Usage: homingbird <command> [options]

  login --server <url> [--name <device name>] [--approve-button] [--no-browser]
  logout
  status
  open [conversationId]                        open the web client, where drafts are approved
  directory [query] [--topic <slug>]
  topics [query]
  inbox [--fresh]
  requests                                     drafts your person asked this agent for
  conversations
  conversation <id>
  draft (--to <email-or-id> | --reply <noteId> | --conversation <id> | --topic <slug> | --request <id>) <text>
  drafts
  overview
  pickup <noteId>
  stream [--after <sequence>]
  run --agent "<command>" [--timeout <seconds>]
                                               answer arriving notes and requests with a headless agent
  approve <draftId> [--body <edited text>]     person only
  discard <draftId>                            person only

Every command accepts --json.`

interface Tokens {
  readonly rest: ReadonlyArray<string>
  readonly values: ReadonlyMap<string, string>
  readonly switches: ReadonlySet<string>
}

const VALUE_FLAGS = new Set([
  'server',
  'name',
  'to',
  'reply',
  'conversation',
  'topic',
  'request',
  'body',
  'after',
  'agent',
  'timeout',
])
const SWITCH_FLAGS = new Set(['json', 'approve-button', 'no-browser', 'fresh', 'help'])

const RUN_TIMEOUT_DEFAULT_SECONDS = 300

const usage = (message: string): Result.Err<CliFailure> =>
  Result.err(CliFailure({ message: `${message}\n\n${USAGE}`, exitCode: EXIT.usage }))

const tokenize = (
  argv: ReadonlyArray<string>,
): Result.Result<{ positionals: string[]; values: Map<string, string>; switches: Set<string> }, CliFailure> => {
  const positionals: string[] = []
  const values = new Map<string, string>()
  const switches = new Set<string>()
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!
    if (argument === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }
    if (!argument.startsWith('--')) {
      positionals.push(argument)
      continue
    }
    const flag = argument.slice(2)
    if (SWITCH_FLAGS.has(flag)) switches.add(flag)
    else if (VALUE_FLAGS.has(flag)) {
      const value = argv[++index]
      if (value === undefined) return usage(`--${flag} needs a value.`)
      values.set(flag, value)
    } else return usage(`Unknown option --${flag}.`)
  }
  return Result.ok({ positionals, values, switches })
}

const draftTarget = (values: ReadonlyMap<string, string>): Result.Result<DraftTarget, CliFailure> => {
  const targets: DraftTarget[] = [
    ...(values.has('to') ? [{ kind: 'to' as const, recipient: values.get('to')! }] : []),
    ...(values.has('reply') ? [{ kind: 'reply' as const, noteId: values.get('reply')! }] : []),
    ...(values.has('conversation')
      ? [{ kind: 'conversation' as const, conversationId: values.get('conversation')! }]
      : []),
    ...(values.has('topic') ? [{ kind: 'topic' as const, slug: values.get('topic')! }] : []),
    ...(values.has('request') ? [{ kind: 'request' as const, requestId: values.get('request')! }] : []),
  ]
  return targets.length === 1
    ? Result.ok(targets[0]!)
    : usage('A draft needs exactly one of --to, --reply, --conversation, --topic or --request.')
}

const joined = (rest: ReadonlyArray<string>): string | null => (rest.length > 0 ? rest.join(' ') : null)

const required = (rest: ReadonlyArray<string>, what: string): Result.Result<string, CliFailure> =>
  rest[0] === undefined ? usage(`Missing ${what}.`) : Result.ok(rest[0])

const BUILDERS: Readonly<Record<string, (tokens: Tokens) => Result.Result<Invocation, CliFailure>>> = {
  help: () => Result.ok({ command: 'help' }),
  login: ({ values, switches }) =>
    values.has('server')
      ? Result.ok({
          command: 'login',
          server: values.get('server')!.replace(/\/+$/, ''),
          name: values.get('name') ?? null,
          approveButton: switches.has('approve-button'),
          openBrowser: !switches.has('no-browser'),
        })
      : usage('login needs --server <url>.'),
  logout: () => Result.ok({ command: 'logout' }),
  status: () => Result.ok({ command: 'status' }),
  directory: ({ rest, values }) =>
    Result.ok({ command: 'directory', query: joined(rest), topic: values.get('topic') ?? null }),
  topics: ({ rest }) => Result.ok({ command: 'topics', query: joined(rest) }),
  requests: () => Result.ok({ command: 'requests' }),
  open: ({ rest }) => Result.ok({ command: 'open', conversationId: rest[0] ?? null }),
  run: ({ values }) => {
    const agent = values.get('agent')?.trim() ?? ''
    if (agent === '') return usage('run needs --agent "<command>", such as --agent "claude -p".')
    const timeout = values.get('timeout')
    if (timeout !== undefined && !/^[1-9][0-9]{0,4}$/.test(timeout))
      return usage('--timeout needs a number of seconds.')
    return Result.ok({
      command: 'run',
      agent,
      timeoutSeconds: timeout === undefined ? RUN_TIMEOUT_DEFAULT_SECONDS : Number(timeout),
    })
  },
  inbox: ({ switches }) => Result.ok({ command: 'inbox', fresh: switches.has('fresh') }),
  conversations: () => Result.ok({ command: 'conversations' }),
  conversation: ({ rest }) => Result.map((id: string) => ({ command: 'conversation' as const, id }))(required(rest, 'the conversation id')),
  draft: ({ rest, values }) =>
    Result.gen(function* () {
      const target = yield* draftTarget(values)
      const text = rest.join(' ').trim()
      if (text === '') return yield* usage('A draft needs some text.')
      return { command: 'draft', target, text } as const
    }),
  drafts: () => Result.ok({ command: 'drafts' }),
  overview: () => Result.ok({ command: 'overview' }),
  pickup: ({ rest }) => Result.map((noteId: string) => ({ command: 'pickup' as const, noteId }))(required(rest, 'the note id')),
  stream: ({ values }) => {
    const after = values.get('after')
    if (after !== undefined && !/^[0-9]{1,15}$/.test(after)) return usage('--after needs a sequence number.')
    return Result.ok({ command: 'stream', after: after === undefined ? null : Number(after) })
  },
  approve: ({ rest, values }) =>
    Result.map((draftId: string) => ({ command: 'approve' as const, draftId, body: values.get('body') ?? null }))(
      required(rest, 'the draft id'),
    ),
  discard: ({ rest }) => Result.map((draftId: string) => ({ command: 'discard' as const, draftId }))(required(rest, 'the draft id')),
}
