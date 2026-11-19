import { Result } from '@homingbird/kernel'
import { agentCommand, defaultReader } from './agent-presets.ts'
import type { RunnerSettings } from './commands/run.ts'
import type { ServiceOptions } from './commands/service.ts'
import { CliFailure, EXIT } from './failure.ts'

export type DraftTarget =
  | { readonly kind: 'to'; readonly recipient: string }
  | { readonly kind: 'reply'; readonly noteId: string }
  | { readonly kind: 'conversation'; readonly conversationId: string }
  | { readonly kind: 'channel'; readonly slug: string }
  | { readonly kind: 'request'; readonly requestId: string }

export type Invocation =
  | { readonly command: 'help' }
  | {
      readonly command: 'login'
      readonly server: string
      readonly name: string | null
      readonly openBrowser: boolean
    }
  | { readonly command: 'logout' }
  | { readonly command: 'status' }
  | { readonly command: 'directory'; readonly query: string | null; readonly channel: string | null }
  | { readonly command: 'channels'; readonly query: string | null }
  | { readonly command: 'requests' }
  | { readonly command: 'open'; readonly conversationId: string | null }
  | ({ readonly command: 'run'; readonly logFile?: string; readonly workdir?: string } & RunnerSettings)
  | { readonly command: 'inbox'; readonly fresh: boolean }
  | { readonly command: 'conversations' }
  | { readonly command: 'conversation'; readonly id: string }
  | {
      readonly command: 'draft'
      readonly target: DraftTarget
      readonly text: string
      readonly basis: string | null
      readonly model: string | null
    }
  | { readonly command: 'drafts' }
  | { readonly command: 'overview' }
  | { readonly command: 'guidance'; readonly conversationId: string }
  | { readonly command: 'pickup'; readonly noteId: string }
  | { readonly command: 'skip'; readonly noteId: string; readonly reason: string | null }
  | { readonly command: 'stream'; readonly after: number | null }
  | ({ readonly command: 'service'; readonly action: 'install' } & ServiceOptions)
  | { readonly command: 'service'; readonly action: 'status' | 'stop' | 'uninstall' }
  | { readonly command: 'desk'; readonly action: 'pause' | 'resume' }
  | { readonly command: 'presets' }

export interface Parsed {
  readonly invocation: Invocation
  readonly json: boolean
  readonly server: string | null
}

/** `platform` decides the preset readers, whose quoting differs on Windows. */
export const parseArguments = (
  argv: ReadonlyArray<string>,
  platform = 'linux',
): Result.Result<Parsed, CliFailure> =>
  Result.gen(function* () {
    const { positionals, values, switches } = yield* tokenize(argv)
    const [command, ...rest] = positionals
    const json = switches.has('json')
    const server = values.get('server')?.replace(/\/+$/, '') || null
    if (command === undefined || switches.has('help'))
      return { invocation: { command: 'help' }, json, server }
    if (!Object.hasOwn(BUILDERS, command)) return yield* usage(`Unknown command "${command}".`)
    return { invocation: yield* BUILDERS[command]!({ rest, values, switches, platform }), json, server }
  })

export const USAGE = `Usage: homingbird <command> [options]

  login --server <url> [--name <device name>] [--no-browser]
  logout
  status
  open [conversationId]                        open the web client, where drafts are approved
  directory [query] [--channel <slug>]
  channels [query]
  inbox [--fresh]
  requests                                     drafts your person asked this agent for
  conversations
  conversation <id>
  draft (--to <email-or-id> | --reply <noteId> | --conversation <id> | --channel <slug> | --request <id>)
        [--basis "<what the draft relies on>"] [--model "<your model>"] <text>
  drafts
  overview
  guidance <conversationId>                    the answering flow and your principles for one
                                               conversation, for a desk about to draft there
  pickup <noteId>
  skip <noteId> [reason]                       give a picked-up note back without drafting
  stream [--after <sequence>]
  run --agent "<command>" [--timeout <seconds>]
      [--split [--reader "<command>"] [--require-toolless-reader]]
                                               answer arriving notes and requests with a headless agent;
                                               with --split, a reader describes each note and the
                                               agent drafts from that description, not the note
  presets                                      agents --agent accepts by name: claude, codex,
                                               antigravity, gemini
  service install --server <url> --agent "<command>" [--timeout <seconds>] [--workdir <dir>]
      [--split [--reader "<command>"] [--require-toolless-reader]]
                                               keep run going: start it when you log in, restart it
                                               if it stops
  service status | service stop | service uninstall
  desk pause | desk resume                     pause or resume the runners for you on this computer

Every command accepts --json, and --server <url> to say which server's credential to use (also
read from HOMINGBIRD_SERVER). Without one, the command uses the only server you are signed in to.`

interface Tokens {
  readonly rest: ReadonlyArray<string>
  readonly values: ReadonlyMap<string, string>
  readonly switches: ReadonlySet<string>
  readonly platform: string
}

const VALUE_FLAGS = new Set([
  'server',
  'name',
  'to',
  'reply',
  'conversation',
  'channel',
  'request',
  'after',
  'agent',
  'timeout',
  'basis',
  'model',
  'reader',
  'workdir',
  'log',
])
const SWITCH_FLAGS = new Set([
  'json',
  'no-browser',
  'fresh',
  'help',
  'split',
  'require-toolless-reader',
  'service',
])

export const RUN_TIMEOUT_DEFAULT_SECONDS = 300

const usage = (message: string): Result.Err<CliFailure> =>
  Result.err(CliFailure({ message: `${message}\n\n${USAGE}`, exitCode: EXIT.usage }))

const tokenize = (
  argv: ReadonlyArray<string>,
): Result.Result<
  { positionals: string[]; values: Map<string, string>; switches: Set<string> },
  CliFailure
> => {
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
    ...(values.has('channel') ? [{ kind: 'channel' as const, slug: values.get('channel')! }] : []),
    ...(values.has('request') ? [{ kind: 'request' as const, requestId: values.get('request')! }] : []),
  ]
  return targets.length === 1
    ? Result.ok(targets[0]!)
    : usage('A draft needs exactly one of --to, --reply, --conversation, --channel or --request.')
}

const timeoutOf = (values: ReadonlyMap<string, string>): Result.Result<number | null, CliFailure> => {
  const timeout = values.get('timeout')
  if (timeout === undefined) return Result.ok(null)
  return /^[1-9][0-9]{0,4}$/.test(timeout)
    ? Result.ok(Number(timeout))
    : usage('--timeout needs a number of seconds.')
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
          openBrowser: !switches.has('no-browser'),
        })
      : usage('login needs --server <url>.'),
  logout: () => Result.ok({ command: 'logout' }),
  status: () => Result.ok({ command: 'status' }),
  directory: ({ rest, values }) =>
    Result.ok({ command: 'directory', query: joined(rest), channel: values.get('channel') ?? null }),
  channels: ({ rest }) => Result.ok({ command: 'channels', query: joined(rest) }),
  requests: () => Result.ok({ command: 'requests' }),
  open: ({ rest }) => Result.ok({ command: 'open', conversationId: rest[0] ?? null }),
  run: ({ values, switches, platform }) =>
    Result.gen(function* () {
      const given = values.get('agent')?.trim() ?? ''
      if (given === '')
        return yield* usage('run needs --agent "<command>" or a preset, such as --agent claude.')
      const timeoutSeconds = yield* timeoutOf(values)
      const isSplit = switches.has('split')
      if (!isSplit && (values.has('reader') || switches.has('require-toolless-reader')))
        return yield* usage('--reader and --require-toolless-reader go with --split.')
      if ((values.has('log') || values.has('workdir')) && !switches.has('service'))
        return yield* usage('--log and --workdir go with --service.')
      const reader = values.get('reader')?.trim() || defaultReader(given, platform)
      return {
        command: 'run',
        agent: agentCommand(given),
        timeoutSeconds: timeoutSeconds ?? RUN_TIMEOUT_DEFAULT_SECONDS,
        split: isSplit ? { reader, requireToollessReader: switches.has('require-toolless-reader') } : null,
        ...(switches.has('service') && { isService: true }),
        ...(values.has('log') && { logFile: values.get('log')! }),
        ...(values.has('workdir') && { workdir: values.get('workdir')! }),
      } as const
    }),
  presets: () => Result.ok({ command: 'presets' }),
  service: ({ rest, values, switches }) =>
    Result.gen(function* () {
      const [action] = rest
      if (action === 'status' || action === 'stop' || action === 'uninstall')
        return { command: 'service', action } as const
      if (action !== 'install') return yield* usage('service needs install, status, stop or uninstall.')
      const agent = values.get('agent')?.trim() ?? ''
      if (agent === '')
        return yield* usage('service install needs --agent "<command>" or a preset, such as --agent claude.')
      const timeoutSeconds = yield* timeoutOf(values)
      if (!switches.has('split') && (values.has('reader') || switches.has('require-toolless-reader')))
        return yield* usage('--reader and --require-toolless-reader go with --split.')
      return {
        command: 'service',
        action,
        agent,
        timeoutSeconds,
        split: switches.has('split'),
        reader: values.get('reader')?.trim() || null,
        requireToollessReader: switches.has('require-toolless-reader'),
        workdir: values.get('workdir')?.trim() || null,
      } as const
    }),
  desk: ({ rest }) => {
    const [action] = rest
    return action === 'pause' || action === 'resume'
      ? Result.ok({ command: 'desk', action })
      : usage('desk needs pause or resume.')
  },
  inbox: ({ switches }) => Result.ok({ command: 'inbox', fresh: switches.has('fresh') }),
  conversations: () => Result.ok({ command: 'conversations' }),
  conversation: ({ rest }) =>
    Result.map((id: string) => ({ command: 'conversation' as const, id }))(
      required(rest, 'the conversation id'),
    ),
  draft: ({ rest, values }) =>
    Result.gen(function* () {
      const target = yield* draftTarget(values)
      const text = rest.join(' ').trim()
      if (text === '') return yield* usage('A draft needs some text.')
      return {
        command: 'draft',
        target,
        text,
        basis: values.get('basis')?.trim() || null,
        model: values.get('model')?.trim() || null,
      } as const
    }),
  drafts: () => Result.ok({ command: 'drafts' }),
  overview: () => Result.ok({ command: 'overview' }),
  guidance: ({ rest }) =>
    Result.map((conversationId: string) => ({ command: 'guidance' as const, conversationId }))(
      required(rest, 'the conversation id'),
    ),
  pickup: ({ rest }) =>
    Result.map((noteId: string) => ({ command: 'pickup' as const, noteId }))(required(rest, 'the note id')),
  skip: ({ rest }) =>
    Result.map((noteId: string) => ({ command: 'skip' as const, noteId, reason: joined(rest.slice(1)) }))(
      required(rest, 'the note id'),
    ),
  stream: ({ values }) => {
    const after = values.get('after')
    if (after !== undefined && !/^[0-9]{1,15}$/.test(after)) return usage('--after needs a sequence number.')
    return Result.ok({ command: 'stream', after: after === undefined ? null : Number(after) })
  },
}
