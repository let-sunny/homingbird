import { type DeskEnv, RUN_TIMEOUT_DEFAULT_SECONDS, type SplitMode } from '@homingbird/cli'
import { type Fetch, httpApi } from '@homingbird/client'
import { type HasClock, Task as T, err, ok, tagged } from '@homingbird/kernel'
import { type Launch, browserOpener } from './browser-opener.ts'
import { makeChannel } from './channel.ts'
import { makeHostedDesk } from './hosted-desk.ts'
import { makeLocalSession } from './local-session.ts'
import { localAdapterOf, noticingRefusals } from './local-tools.ts'
import { type McpContext, toolContextOf } from './server.ts'
import { runStdioSession } from './stdio-session.ts'
import { announcedRequests } from './triggers.ts'

export interface StdioProgram {
  readonly arguments: ReadonlyArray<string>
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly credentialPath: string
  readonly version: string
  readonly input: AsyncIterable<string | Uint8Array>
  readonly write: (line: string) => void
  readonly nonce: () => string
  readonly fetch?: Fetch
  readonly launch?: Launch
  readonly platform?: string
  /** What a desk runner started with --run-agent needs from this computer; without it, none can start. */
  readonly deskEnv?: DeskEnv
  /** Where the desk runner reports; never standard output, which carries the MCP messages. */
  readonly log?: (line: string) => void
}
export type ProgramFailed = ReturnType<typeof ProgramFailed>

export const USAGE = [
  'Usage: homingbird-mcp --server <url> [--name <client name>] [--channel] [--desk | --run-agent "<command>"]',
  '',
  '  --server   The address of your Homingbird server. Also read from HOMINGBIRD_SERVER.',
  '  --name     How this agent appears in your credential list.',
  '  --channel  Push arriving notes into a Claude Code session started with --channels.',
  '  --desk     Make this your desk session: it holds the event stream, checks the inbox at',
  '             the start and answers what arrives. Implies --channel. Keep only one desk.',
  '  --run-agent  Run your desk inside this server while the MCP client is open: each arriving',
  '             note is answered by this agent command, such as "claude -p". Every draft waits',
  '             for approval in the web client. Also read from HOMINGBIRD_RUN_AGENT.',
  '             The desk prompt pauses and resumes it.',
  '  --split    With --run-agent: a reader turns each note into a few checked fields, and the',
  '             agent drafts from those, never from the note. Also HOMINGBIRD_SPLIT=1.',
  '  --reader   The reader command for --split, such as "claude -p --tools \'\' --strict-mcp-config";',
  '             the agent command by default. Also HOMINGBIRD_READER.',
  '  --require-toolless-reader  Refuse to start when the reader is the agent command itself.',
  '',
  'HOMINGBIRD_CREDENTIALS_FILE names the credential file of the runner that started this server for',
  'one agent run, as homingbird run --attach-mcp does; it then only reads that file.',
  '',
  'Signing in happens from the MCP client: ask your agent to log in.',
].join('\n')

export const RUNNERS_SERVER_ONLY =
  'HOMINGBIRD_CREDENTIALS_FILE is set: this server answers one agent run of homingbird run, so it takes no --run-agent, --desk or --channel.'

/** The runner picks notes up, gives them back and waits for them; its agent only reads and drafts. */
export const RUNNER_WITHHELD_TOOLS: ReadonlyArray<string> = ['skip_note', 'wait_for_notes']

export const runStdioProgram = (program: StdioProgram): T.Task<void, ProgramFailed, HasClock> =>
  T.gen(function* () {
    const options = yield* T.fromResult(optionsFrom(program))
    const runnerCredentialPath = program.environment.HOMINGBIRD_CREDENTIALS_FILE?.trim() || null
    if (runnerCredentialPath !== null && (options.agent !== null || options.isChannel))
      return yield* T.fail(ProgramFailed({ message: RUNNERS_SERVER_ONLY }))
    const deskEnv = program.deskEnv
    if (options.agent !== null && deskEnv === undefined)
      return yield* T.fail(ProgramFailed({ message: 'This build of homingbird-mcp cannot run a desk.' }))
    const clock = yield* T.Clock
    const fetching = program.fetch !== undefined ? { fetch: program.fetch } : {}
    const opening =
      program.launch !== undefined
        ? { openInBrowser: browserOpener(program.launch, program.platform ?? 'linux', options.serverUrl) }
        : {}
    yield* T.scoped((scope) =>
      T.gen(function* () {
        const announced = announcedRequests()
        const desk =
          options.agent === null
            ? null
            : makeHostedDesk({
                settings: {
                  agent: options.agent,
                  timeoutSeconds: RUN_TIMEOUT_DEFAULT_SECONDS,
                  split: options.split,
                },
                serverUrl: options.serverUrl,
                scope,
                env: deskEnv!,
                log: program.log ?? (() => {}),
              })
        const channel = options.isChannel ? makeChannel(() => toolContextOf(context), program.write) : null
        const session = makeLocalSession({
          serverUrl: options.serverUrl,
          clientName: options.clientName,
          credentialPath: program.credentialPath,
          runnerCredentialPath,
          scope,
          clock,
          ...fetching,
          ...opening,
          ...(channel !== null && { listener: { online: channel.online, received: channel.received } }),
          ...(desk !== null && { desk }),
        })
        const context: McpContext = {
          api: noticingRefusals(
            httpApi({ serverUrl: options.serverUrl, token: session.token, ...fetching }),
            session,
          ),
          serverVersion: program.version,
          nonce: program.nonce,
          webClientUrl: options.serverUrl,
          local: localAdapterOf(session, desk),
          desk: options.isDesk,
          announced,
          ...(runnerCredentialPath !== null && { withheldTools: RUNNER_WITHHELD_TOOLS }),
          ...opening,
          ...(channel !== null && {
            channel: {
              opened: T.suspend(() =>
                session.state().kind === 'signed_in' ? channel.opened : channel.armed,
              ),
            },
          }),
        }
        yield* session.restore
        yield* runStdioSession({ input: program.input, write: program.write, context })
      }),
    )
  })

interface Options {
  readonly serverUrl: string
  readonly clientName: string
  readonly isChannel: boolean
  readonly isDesk: boolean
  readonly agent: string | null
  readonly split: SplitMode | null
}

const optionsFrom = (program: StdioProgram) => {
  const flag = (name: string): string | undefined => {
    const index = program.arguments.indexOf(name)
    return index === -1 ? undefined : program.arguments[index + 1]
  }
  const serverUrl = flag('--server') ?? program.environment.HOMINGBIRD_SERVER
  const agent = (flag('--run-agent') ?? program.environment.HOMINGBIRD_RUN_AGENT ?? '').trim()
  if (program.arguments.includes('--run-agent') && agent === '')
    return err(ProgramFailed({ message: `--run-agent needs the agent command.\n\n${USAGE}` }))
  if (agent !== '' && program.arguments.includes('--desk'))
    return err(ProgramFailed({ message: `Use --run-agent or --desk, not both.\n\n${USAGE}` }))
  const isSplit = program.arguments.includes('--split') || program.environment.HOMINGBIRD_SPLIT === '1'
  const reader = (flag('--reader') ?? program.environment.HOMINGBIRD_READER ?? '').trim()
  const requireToollessReader = program.arguments.includes('--require-toolless-reader')
  const askedForSplit =
    program.arguments.includes('--split') || flag('--reader') !== undefined || requireToollessReader
  if (askedForSplit && agent === '')
    return err(ProgramFailed({ message: `--split and --reader go with --run-agent.\n\n${USAGE}` }))
  if (!isSplit && (reader !== '' || requireToollessReader))
    return err(
      ProgramFailed({ message: `--reader and --require-toolless-reader go with --split.\n\n${USAGE}` }),
    )
  return serverUrl !== undefined && /^https?:\/\/\S+$/.test(serverUrl)
    ? ok<Options>({
        agent: agent === '' ? null : agent,
        split: isSplit ? { reader: reader === '' ? agent : reader, requireToollessReader } : null,
        serverUrl: serverUrl.replace(/\/+$/, ''),
        clientName: flag('--name') ?? 'MCP agent',
        isChannel: program.arguments.includes('--channel') || program.arguments.includes('--desk'),
        isDesk: program.arguments.includes('--desk'),
      })
    : err(ProgramFailed({ message: USAGE }))
}

const ProgramFailed = tagged('ProgramFailed')<{ readonly message: string }>()
