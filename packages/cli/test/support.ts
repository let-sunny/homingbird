import type { Fetch } from '@homingbird/client'
import { type Clock, Task as T, makeTestClock } from '@homingbird/kernel'
import {
  API_PREFIX,
  type ApiError,
  FEATURES,
  FEATURE_NAMES,
  HTTP_STATUS,
  PROTOCOL_VERSION,
  type RouteName,
  contract,
  matchPath,
  toErrorBody,
} from '@homingbird/protocol'
import type { Stubs } from '../../mcp/test/support.ts'
import { runCli } from '../src/cli.ts'
import { AGENTS_DIRECTORY, serverKey } from '../src/credentials.ts'
import type { AgentRun, CliEnv, ProcessRun } from '../src/environment.ts'

export * from '../../mcp/test/support.ts'

export const SERVER = 'https://hb.example.com'
export const AGENT_TOKEN = 'hba_agent-token-0123456789abcdefghij'
export const HOME = '/home/june'
export const agentFileFor = (serverUrl: string): string =>
  `${HOME}/.config/homingbird/${AGENTS_DIRECTORY}/${encodeURIComponent(serverKey(serverUrl))}.json`
export const AGENT_FILE = agentFileFor(SERVER)

export const INTERRUPTED = -1

export interface Call {
  readonly method: string
  readonly path: string
  readonly route: RouteName | null
  readonly authorization: string | null
  readonly body: string
}

export interface World {
  readonly env: CliEnv
  readonly lines: string[]
  readonly problems: string[]
  readonly files: Map<string, string>
  readonly privateWrites: string[]
  readonly calls: Call[]
  readonly stop: AbortController
  readonly clock: ReturnType<typeof makeTestClock>
  readonly run: (...argv: string[]) => Promise<number>
  readonly json: () => any
  readonly opened: string[]
  readonly agentRuns: Array<{
    readonly command: string
    readonly prompt: string
    readonly environment: Readonly<Record<string, string>>
  }>
  readonly reads: string[]
  readonly processRuns: string[][]
  readonly ownerOnlyWrites: string[]
}

export interface WorldOptions {
  readonly stubs?: Stubs
  readonly other?: (call: Call) => Response | Promise<Response> | undefined
  readonly fetch?: Fetch
  readonly clock?: Clock & ReturnType<typeof makeTestClock>
  readonly signedIn?: 'agent' | 'none'
  readonly variables?: Readonly<Record<string, string | undefined>>
  readonly browser?: (url: string) => boolean | Promise<boolean>
  readonly agent?: (prompt: string, signal: AbortSignal) => AgentRun | Promise<AgentRun>
  readonly platform?: string
  readonly userId?: number | null
  readonly process?: (
    program: string,
    args: ReadonlyArray<string>,
  ) => ProcessRun | undefined | Promise<ProcessRun | undefined>
  /** Which paths hold a program this computer can run; every path does when not given. */
  readonly runnable?: (path: string) => boolean
  /** Symbolic links: where each path leads. */
  readonly links?: Readonly<Record<string, string>>
  readonly program?: ReadonlyArray<string>
  /** Permission bits of files; 0600 when not given. */
  readonly modes?: Readonly<Record<string, number>>
  /** Files this process may read but not change or remove, such as a secret mounted read-only. */
  readonly readOnly?: ReadonlyArray<string>
  /** Files that are there but that this process may not read. */
  readonly unreadable?: ReadonlyArray<string>
  /** Files there from the start, besides the agent credential. */
  readonly files?: Readonly<Record<string, string>>
}

export const world = (options: WorldOptions = {}): World => {
  const lines: string[] = []
  const problems: string[] = []
  const files = new Map<string, string>()
  const privateWrites: string[] = []
  const calls: Call[] = []
  const stop = new AbortController()
  const clock = options.clock ?? makeTestClock(1_700_000_000_000)
  if ((options.signedIn ?? 'agent') === 'agent')
    files.set(AGENT_FILE, JSON.stringify({ serverUrl: SERVER, token: AGENT_TOKEN }))
  for (const [path, content] of Object.entries(options.files ?? {})) files.set(path, content)
  let nonces = 0
  const opened: string[] = []
  const agentRuns: World['agentRuns'] = []
  const reads: string[] = []
  const processRuns: string[][] = []
  const ownerOnlyWrites: World['ownerOnlyWrites'] = []
  const env: CliEnv = {
    clock,
    fetch: options.fetch ?? stubbedFetch(options.stubs ?? {}, calls, options.other),
    files: {
      read: (path) =>
        T.sync(() => {
          reads.push(path)
          if (options.unreadable?.includes(path)) return null
          return files.get(path) ?? null
        }),
      exists: (path) => T.sync(() => files.has(path)),
      writePrivate: (path, content) =>
        T.sync(() => {
          privateWrites.push(path)
          files.set(path, content)
        }),
      writeOwnerOnly: (path, content) =>
        T.sync(() => {
          ownerOnlyWrites.push(path)
          files.set(path, content)
        }),
      createExclusive: (path, content) =>
        T.sync(() => {
          if (files.has(path)) return false
          files.set(path, content)
          return true
        }),
      remove: (path) => T.sync(() => void files.delete(path)),
      mode: (path) => T.sync(() => (files.has(path) ? (options.modes?.[path] ?? 0o600) : null)),
      isWritable: (path) => T.sync(() => files.has(path) && !(options.readOnly ?? []).includes(path)),
      list: (directory) =>
        T.sync(() =>
          [...files.keys()]
            .filter(
              (path) => path.startsWith(`${directory}/`) && !path.slice(directory.length + 1).includes('/'),
            )
            .map((path) => path.slice(directory.length + 1)),
        ),
    },
    output: { line: (text) => lines.push(text), problem: (text) => problems.push(text) },
    variables: options.variables ?? {},
    homeDirectory: HOME,
    hostName: 'laptop',
    nonce: () => `nonce${String(nonces++).padStart(15, '0')}`,
    stopped: stop.signal,
    server: null,
    credentialsFile: null,
    platform: options.platform ?? 'linux',
    program: options.program ?? ['/usr/bin/node', '/usr/lib/node_modules/@homingbird/cli/dist/homingbird.js'],
    userId: options.userId === undefined ? 1000 : options.userId,
    programs: {
      realPath: async (path) => options.links?.[path] ?? path,
      isRunnable: async (path) => options.runnable?.(path) ?? true,
    },
    processes: {
      run: async (program, args) => {
        processRuns.push([program, ...args])
        return (await options.process?.(program, args)) ?? { exitCode: 0, output: '' }
      },
    },
    launcher: {
      openInBrowser: async (url) => {
        opened.push(url)
        return (await options.browser?.(url)) ?? false
      },
      runAgent: async (command, prompt, environment, signal) => {
        agentRuns.push({ command, prompt, environment })
        return (await options.agent?.(prompt, signal)) ?? { exitCode: 0, output: 'Drafted reply.' }
      },
    },
  }
  return {
    ownerOnlyWrites,
    processRuns,
    opened,
    agentRuns,
    reads,
    env,
    lines,
    problems,
    files,
    privateWrites,
    calls,
    stop,
    clock,
    run: async (...argv) => {
      const exit = await T.run(runCli(argv), env, stop.signal)
      return exit._tag === 'Ok' ? exit.value : INTERRUPTED
    },
    json: () => JSON.parse(lines.at(-1)!),
  }
}

export const stubbedFetch =
  (stubs: Stubs, calls: Call[], other?: WorldOptions['other']): Fetch =>
  async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url)
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const matched = routeOf(method, pathname)
    const call: Call = {
      method,
      path: pathname,
      route: matched?.name ?? null,
      authorization: headers.get('authorization'),
      body: typeof init.body === 'string' ? init.body : '',
    }
    calls.push(call)
    if (matched === null) return (await other?.(call)) ?? new Response('{}', { status: 404 })
    const stub = (stubs[matched.name] ?? (matched.name === 'server.info' ? currentServer : undefined)) as
      | ((request: unknown) => unknown)
      | undefined
    if (stub === undefined)
      return json(503, toErrorBody({ _tag: 'Unavailable', message: `not stubbed: ${matched.name}` }))
    const answer = stub({
      params: matched.params,
      query: Object.fromEntries(searchParams),
      ...(call.body !== '' && { body: JSON.parse(call.body) }),
    })
    return isApiError(answer) ? json(HTTP_STATUS[answer._tag], toErrorBody(answer)) : json(200, answer)
  }

const routeOf = (
  method: string,
  path: string,
): { name: RouteName; params: Record<string, string> } | null => {
  for (const name of Object.keys(contract) as RouteName[]) {
    if (contract[name].method !== method) continue
    const params = matchPath(`${API_PREFIX}${contract[name].path}`, path)
    if (params !== null) return { name, params }
  }
  return null
}

const json = (status: number, value: unknown): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

const isApiError = (value: unknown): value is ApiError =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { _tag?: unknown })._tag === 'string' &&
  (value as { _tag: string })._tag in HTTP_STATUS

/** A server of this client's protocol that offers every feature, for a test that does not ask otherwise. */
const currentServer = () => ({
  name: 'dovecote',
  version: '0.1.3',
  contactMode: 'open',
  signInWith: 'Development login',
  features: Object.fromEntries(FEATURE_NAMES.map((name) => [name, FEATURES[name].default])),
  protocolVersion: PROTOCOL_VERSION,
})
