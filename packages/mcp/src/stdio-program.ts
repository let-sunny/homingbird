import { type Fetch, httpApi } from '@homingbird/client'
import { type HasClock, Task as T, err, ok, tagged } from '@homingbird/kernel'
import { type Launch, browserOpener } from './browser-opener.ts'
import { makeLocalSession } from './local-session.ts'
import { localAdapterOf, noticingRefusals } from './local-tools.ts'
import { runStdioSession } from './stdio-session.ts'

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
  'Usage: homingbird-mcp --server <url> [--name <client name>]',
  '',
  '  --server  The address of your Homingbird server. Also read from HOMINGBIRD_SERVER.',
  '  --name    How this agent appears in your credential list.',
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
        const session = makeLocalSession({
          serverUrl: options.serverUrl,
          clientName: options.clientName,
          credentialPath: program.credentialPath,
          scope,
          clock,
          ...fetching,
          ...opening,
        })
        yield* session.restore
        yield* runStdioSession({
          input: program.input,
          write: program.write,
          context: {
            api: noticingRefusals(
              httpApi({ serverUrl: options.serverUrl, token: session.token, ...fetching }),
              session,
            ),
            serverVersion: program.version,
            nonce: program.nonce,
            webClientUrl: options.serverUrl,
            local: localAdapterOf(session),
            ...opening,
          },
        })
      }),
    )
  })

interface Options {
  readonly serverUrl: string
  readonly clientName: string
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
      })
    : err(ProgramFailed({ message: USAGE }))
}
