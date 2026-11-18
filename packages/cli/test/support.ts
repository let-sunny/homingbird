import type { Fetch } from '@homingbird/client'
import { type Clock, Task as T, makeTestClock } from '@homingbird/kernel'
import {
  API_PREFIX,
  type ApiError,
  HTTP_STATUS,
  type RouteName,
  contract,
  matchPath,
  toErrorBody,
} from '@homingbird/protocol'
import type { Stubs } from '../../mcp/test/support.ts'
import { runCli } from '../src/cli.ts'
import { AGENTS_DIRECTORY, serverKey } from '../src/credentials.ts'
import type { AgentRun, CliEnv } from '../src/environment.ts'

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
  let nonces = 0
  const opened: string[] = []
  const agentRuns: World['agentRuns'] = []
  const reads: string[] = []
  const env: CliEnv = {
    clock,
    fetch: options.fetch ?? stubbedFetch(options.stubs ?? {}, calls, options.other),
    files: {
      read: async (path) => {
        reads.push(path)
        return files.get(path) ?? null
      },
      exists: async (path) => files.has(path),
      writePrivate: async (path, content) => {
        privateWrites.push(path)
        files.set(path, content)
      },
      remove: async (path) => void files.delete(path),
      list: async (directory) =>
        [...files.keys()]
          .filter(
            (path) => path.startsWith(`${directory}/`) && !path.slice(directory.length + 1).includes('/'),
          )
          .map((path) => path.slice(directory.length + 1)),
    },
    output: { line: (text) => lines.push(text), problem: (text) => problems.push(text) },
    variables: options.variables ?? {},
    homeDirectory: HOME,
    hostName: 'laptop',
    nonce: () => `nonce${String(nonces++).padStart(15, '0')}`,
    stopped: stop.signal,
    server: null,
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
    const stub = stubs[matched.name] as ((request: unknown) => unknown) | undefined
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
