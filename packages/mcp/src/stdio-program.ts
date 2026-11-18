import { type Fetch, httpApi } from '@homingbird/client'
import { type HasClock, Task as T, err, ok, tagged } from '@homingbird/kernel'
import { type Launch, browserOpener } from './browser-opener.ts'
import { makeChannel } from './channel.ts'
import { makeLocalSession } from './local-session.ts'
import { localAdapterOf, noticingRefusals } from './local-tools.ts'
import { type McpContext, toolContextOf } from './server.ts'
import { runStdioSession } from './stdio-session.ts'
import { announcedRequests } from './triggers.ts'

export interface StdioProgram {
  readonly arguments: ReadonlyArray<string>
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly credentialPath: string
  readonly hostName: string
  readonly version: string
  readonly input: AsyncIterable<string | Uint8Array>
  readonly write: (line: string) => void
  readonly nonce: () => string
  readonly fetch?: Fetch
  readonly launch?: Launch
  readonly platform?: string
}

export const ProgramFailed = tagged('ProgramFailed')<{ readonly message: string }>()
export type ProgramFailed = ReturnType<typeof ProgramFailed>

export const USAGE = [
  'Usage: homingbird-mcp --server <url> [--name <client name>] [--channel] [--desk]',
  '',
  '  --server   The address of your Homingbird server. Also read from HOMINGBIRD_SERVER.',
  '  --name     How this agent appears in your credential list.',
  '  --channel  Push arriving notes into a Claude Code session started with --channels.',
  '  --desk     Make this your desk session: it holds the event stream, checks the inbox at',
  '             the start and answers what arrives. Implies --channel. Keep only one desk.',
  '',
  'Signing in happens from the MCP client: ask your agent to log in.',
].join('\n')

export const runStdioProgram = (program: StdioProgram): T.Task<void, ProgramFailed, HasClock> =>
  T.gen(function* () {
    const options = yield* T.fromResult(optionsFrom(program))
    const clock = yield* T.Clock
    const fetching = program.fetch !== undefined ? { fetch: program.fetch } : {}
    const opening =
      program.launch !== undefined
        ? { openInBrowser: browserOpener(program.launch, program.platform ?? 'linux', options.serverUrl) }
        : {}
    yield* T.scoped((scope) =>
      T.gen(function* () {
        const announced = announcedRequests()
        const channel = options.isChannel ? makeChannel(() => toolContextOf(context), program.write) : null
        const session = makeLocalSession({
          serverUrl: options.serverUrl,
          clientName: options.clientName,
          credentialPath: program.credentialPath,
          scope,
          clock,
          ...fetching,
          ...opening,
          ...(channel !== null && { listener: { online: channel.online, received: channel.received } }),
        })
        const context: McpContext = {
          api: noticingRefusals(
            httpApi({ serverUrl: options.serverUrl, token: session.token, ...fetching }),
            session,
          ),
          serverVersion: program.version,
          nonce: program.nonce,
          webClientUrl: options.serverUrl,
          local: localAdapterOf(session),
          desk: options.isDesk,
          announced,
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
}

const optionsFrom = (program: StdioProgram) => {
  const flag = (name: string): string | undefined => {
    const index = program.arguments.indexOf(name)
    return index === -1 ? undefined : program.arguments[index + 1]
  }
  const serverUrl = flag('--server') ?? program.environment.HOMINGBIRD_SERVER
  return serverUrl !== undefined && /^https?:\/\/\S+$/.test(serverUrl)
    ? ok<Options>({
        serverUrl: serverUrl.replace(/\/+$/, ''),
        clientName: flag('--name') ?? `MCP agent on ${program.hostName}`,
        isChannel: program.arguments.includes('--channel') || program.arguments.includes('--desk'),
        isDesk: program.arguments.includes('--desk'),
      })
    : err(ProgramFailed({ message: USAGE }))
}
