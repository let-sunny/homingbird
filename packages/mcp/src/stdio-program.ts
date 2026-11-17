import { type Fetch, eventStream, httpApi } from '@homingbird/client'
import { type HasClock, Task as T, err, ok, tagged } from '@homingbird/kernel'
import { agentToken } from './agent-sign-in.ts'
import { runStdioSession } from './stdio-session.ts'

export interface StdioProgram {
  readonly arguments: ReadonlyArray<string>
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly credentialPath: string
  readonly hostName: string
  readonly version: string
  readonly input: AsyncIterable<string | Uint8Array>
  readonly write: (line: string) => void
  readonly announce: (line: string) => void
  readonly nonce: () => string
  readonly fetch?: Fetch
}

export const ProgramFailed = tagged('ProgramFailed')<{ readonly message: string }>()
export type ProgramFailed = ReturnType<typeof ProgramFailed>

export const USAGE = [
  'Usage: homingbird-mcp --server <url> [--name <client name>]',
  '',
  '  --server  The address of your Homingbird server. Also read from HOMINGBIRD_SERVER.',
  '  --name    How this agent appears in your credential list.',
].join('\n')

export const runStdioProgram = (program: StdioProgram): T.Task<void, ProgramFailed, HasClock> =>
  T.gen(function* () {
    const options = yield* T.fromResult(optionsFrom(program))
    const clock = yield* T.Clock
    const fetch = program.fetch !== undefined ? { fetch: program.fetch } : {}
    const token = yield* T.mapError((failed: { readonly message: string }) =>
      ProgramFailed({ message: `Could not sign in: ${failed.message}` }),
    )(
      agentToken({
        serverUrl: options.serverUrl,
        clientName: options.clientName,
        credentialPath: program.credentialPath,
        announce: program.announce,
        ...fetch,
      }),
    )
    const connection = { serverUrl: options.serverUrl, token: () => token, ...fetch }
    const staysOnline = T.promise(async (signal) => {
      for await (const _ of eventStream({ ...connection, clock }, signal)) continue
    })
    yield* T.scoped((scope) =>
      T.gen(function* () {
        yield* scope.fork(staysOnline)
        yield* runStdioSession({
          input: program.input,
          write: program.write,
          context: {
            api: httpApi(connection),
            serverVersion: program.version,
            nonce: program.nonce,
            webClientUrl: options.serverUrl,
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
