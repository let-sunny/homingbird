import type { EngineInterface, PluginOptions } from 'claude-code'

import { describeCause, host, hostOr, rescued } from './effects'
import { type Deferred, T, makeDeferred } from './kernel.mjs'

export type BundleFinder = {
  readonly plugin: Pick<EngineInterface['plugin'], 'root'>
  readonly fs: Pick<EngineInterface['fs'], 'stat' | 'exists' | 'list'>
  readonly process: Pick<EngineInterface['process'], 'run'>
  readonly env: Pick<EngineInterface['env'], 'get'>
}

export type Command =
  | { readonly kind: 'ready'; readonly argv: ReadonlyArray<string> }
  | { readonly kind: 'no-node'; readonly olderVersion: string | null }

export type Ran =
  | { readonly kind: 'ok'; readonly value: unknown; readonly text: string }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'unsupported'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'no-node'; readonly olderVersion: string | null; readonly message: string }

/** What a command runs for: the plugin's options, and the one server this session is bound to, if known. */
export interface CliTarget {
  readonly options: PluginOptions
  readonly server: string
}

export function run(
  $: BundleFinder,
  target: CliTarget,
  args: ReadonlyArray<string>,
  hostEnv?: Readonly<Record<string, string>>,
): T.Task<Ran> {
  return rescued(
    T.gen(function* () {
      const command = yield* commandOf($, target.options)
      if (command.kind === 'no-node') return { ...command, message: noNodeMessage(command.olderVersion) }
      const result = yield* host(() =>
        $.process.run([...command.argv, ...serverArguments(target.server), ...args], {
          timeoutMs: RUN_TIMEOUT_MS,
          ...(hostEnv !== undefined && { env: { ...hostEnv } }),
        }),
      )
      if (result.exitCode === 0) return { kind: 'ok', value: null, text: result.stdout.trim() } as const
      if (result.exitCode === EXIT_SIGNED_OUT) return { kind: 'signed-out' } as const
      if (result.exitCode === EXIT_USAGE)
        return { kind: 'unsupported', message: messageIn(result.stderr) } as const
      return { kind: 'failed', message: messageIn(result.stderr) } as const
    }),
    (cause): Ran => ({
      kind: 'unavailable',
      message: `The homingbird command could not be started: ${describeCause(cause)}`,
    }),
  )
}

export function runJson($: BundleFinder, target: CliTarget, args: ReadonlyArray<string>): T.Task<Ran> {
  return T.map((ran: Ran): Ran => (ran.kind === 'ok' ? { ...ran, value: lastJsonLine(ran.text) } : ran))(
    run($, target, [...args, '--json']),
  )
}

/** How to start the command line, worked out once per configuration and kept for the session. */
export function commandOf($: BundleFinder, options: PluginOptions): T.Task<Command, unknown> {
  return T.suspend(() => {
    const known = RESOLVED.get(options)
    if (known !== undefined)
      return T.flatMap((exit: T.Exit<Command, unknown>) => T.fromExit(exit))(known.wait)
    const resolving = makeDeferred<T.Exit<Command, unknown>>()
    RESOLVED.set(options, resolving)
    return T.flatMap((exit: T.Exit<Command, unknown>) => {
      resolving.resolve(exit)
      return T.fromExit(exit)
    })(T.exit(resolveCommand($, options)))
  })
}

/** The arguments that bind a command to one server, so it never uses another server's credential. */
export const serverArguments = (server: string): string[] => (server === '' ? [] : ['--server', server])

export const MINIMUM_NODE_MAJOR = 22

export const lastJsonLine = (text: string): unknown => {
  const line = text.trim().split('\n').at(-1) ?? ''
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

export const DEFAULT_COMMAND = 'npx -y @homingbird/cli'

export const BUNDLED_CLI = 'cli/homingbird.mjs'

/** Where the plugin's settings are; the host does not tell a plugin its marketplace, so no plugin id is named. */
export const CONFIGURE_COMMAND = 'the Homingbird plugin settings (/plugin)'

const RUN_TIMEOUT_MS = 60_000
const VERSION_TIMEOUT_MS = 10_000
const RESOLVED = new WeakMap<PluginOptions, Deferred<T.Exit<Command, unknown>>>()

function resolveCommand($: BundleFinder, options: PluginOptions): T.Task<Command> {
  return T.gen(function* () {
    const configured = configuredCommandOf(options)
    const bundled = `${$.plugin.root}/${BUNDLED_CLI}`
    const hasBundle = yield* isFile($, bundled)
    if (configured.length > 1 || (configured.length === 1 && !isNodePath(configured[0]!)))
      return { kind: 'ready', argv: configured } as const
    const node = configured.length === 1 ? yield* nodeAt($, configured[0]!) : yield* findNode($)
    if (node.kind === 'no-node') return node
    // messageIn shows the first line of stderr, so a Node warning there would hide the command's own error.
    if (hasBundle) return { kind: 'ready', argv: [node.path, '--no-warnings', bundled] } as const
    const npx = node.path === 'node' ? 'npx' : node.path.replace(/node(\.exe)?$/, 'npx$1')
    return (yield* versionOf($, npx)) === null
      ? ({ kind: 'no-node', olderVersion: null } as const)
      : ({ kind: 'ready', argv: [npx, ...DEFAULT_COMMAND.split(' ').slice(1)] } as const)
  })
}

type FoundNode = { readonly kind: 'found'; readonly path: string } | Extract<Command, { kind: 'no-node' }>

function findNode($: BundleFinder): T.Task<FoundNode> {
  return T.gen(function* () {
    let older: string | null = null
    for (const candidate of yield* nodeCandidates($)) {
      const found = yield* nodeAt($, candidate)
      if (found.kind === 'found') return found
      older ??= found.olderVersion
    }
    return { kind: 'no-node', olderVersion: older } as const
  })
}

function nodeAt($: BundleFinder, path: string): T.Task<FoundNode> {
  return T.gen(function* () {
    if (path.includes('/') && !(yield* hostOr(() => $.fs.exists(path), false)))
      return { kind: 'no-node', olderVersion: null } as const
    const version = yield* versionOf($, path)
    if (version === null) return { kind: 'no-node', olderVersion: null } as const
    return majorOf(version) >= MINIMUM_NODE_MAJOR
      ? ({ kind: 'found', path } as const)
      : ({ kind: 'no-node', olderVersion: version } as const)
  })
}

function nodeCandidates($: BundleFinder): T.Task<string[]> {
  return T.gen(function* () {
    const home = (yield* host(() => $.env.get('HOME'))) ?? ''
    const nvm = (yield* host(() => $.env.get('NVM_DIR'))) || `${home}/.nvm`
    const fnm = (yield* host(() => $.env.get('FNM_DIR'))) || `${home}/.local/share/fnm`
    return [
      'node',
      ...(yield* nvmNodes($, `${nvm}/versions/node`)),
      `${home}/.volta/bin/node`,
      `${home}/.asdf/shims/node`,
      `${fnm}/aliases/default/bin/node`,
      `${home}/Library/Application Support/fnm/aliases/default/bin/node`,
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
    ]
  })
}

function nvmNodes($: BundleFinder, versions: string): T.Task<string[]> {
  return T.map((entries: ReadonlyArray<{ readonly kind: string; readonly name: string }>) =>
    entries
      .filter((entry) => entry.kind === 'dir' && majorOf(entry.name) >= MINIMUM_NODE_MAJOR)
      .map((entry) => entry.name)
      .sort(newestFirst)
      .map((name) => `${versions}/${name}/bin/node`),
  )(hostOr(() => $.fs.list(versions), []))
}

function versionOf($: BundleFinder, executable: string): T.Task<string | null> {
  return T.map((result: { readonly exitCode: number | null; readonly stdout: string } | null) => {
    const version = result?.stdout.trim() ?? ''
    return result?.exitCode === 0 && /^v?\d+\./.test(version) ? version : null
  })(hostOr(() => $.process.run([executable, '--version'], { timeoutMs: VERSION_TIMEOUT_MS }), null))
}

const majorOf = (version: string): number => Number(/^v?(\d+)\./.exec(version)?.[1] ?? 0)

const newestFirst = (a: string, b: string): number => {
  const parts = (version: string) => version.replace(/^v/, '').split('.').map(Number)
  const [left, right] = [parts(a), parts(b)]
  for (let index = 0; index < 3; index += 1)
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (right[index] ?? 0) - (left[index] ?? 0)
  return 0
}

const isNodePath = (word: string): boolean => /(^|[\\/])node(\.exe)?$/.test(word)

const noNodeMessage = (olderVersion: string | null): string =>
  olderVersion === null
    ? `Node ${MINIMUM_NODE_MAJOR} or newer was not found, so the homingbird command cannot run. Start Claude Code from a shell where node -v works, or set the plugin's Homingbird command to the full path of node in ${CONFIGURE_COMMAND}.`
    : `Node ${olderVersion} is too old; the homingbird command needs Node ${MINIMUM_NODE_MAJOR} or newer. Start Claude Code from a shell where node -v shows ${MINIMUM_NODE_MAJOR} or newer, or set the plugin's Homingbird command to the full path of a newer node in ${CONFIGURE_COMMAND}.`
const EXIT_USAGE = 2
const EXIT_SIGNED_OUT = 3

const messageIn = (stderr: string): string => {
  const parsed = lastJsonLine(stderr)
  const message =
    typeof parsed === 'object' && parsed !== null ? (parsed as { error?: unknown }).error : undefined
  return typeof message === 'string'
    ? message.split('\n')[0]!
    : stderr.trim().split('\n')[0] || 'The homingbird command failed.'
}

const configuredCommandOf = (options: PluginOptions): string[] =>
  String(options.command ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')

function isFile($: BundleFinder, path: string): T.Task<boolean> {
  return hostOr(() => $.fs.stat(path).then((stat) => stat.kind === 'file'), false)
}
