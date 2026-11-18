import type { EngineInterface, PluginOptions } from 'claude-code'

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

/** What a command runs for: the mod's options, and the one server this session is bound to, if known. */
export interface CliTarget {
  readonly options: PluginOptions
  readonly server: string
}

export async function run($: BundleFinder, target: CliTarget, args: ReadonlyArray<string>): Promise<Ran> {
  try {
    const command = await commandOf($, target.options)
    if (command.kind === 'no-node') return { ...command, message: noNodeMessage(command.olderVersion) }
    const result = await $.process.run([...command.argv, ...serverArguments(target.server), ...args], {
      timeoutMs: RUN_TIMEOUT_MS,
    })
    if (result.exitCode === 0) return { kind: 'ok', value: null, text: result.stdout.trim() }
    if (result.exitCode === EXIT_SIGNED_OUT) return { kind: 'signed-out' }
    if (result.exitCode === EXIT_USAGE) return { kind: 'unsupported', message: messageIn(result.stderr) }
    return { kind: 'failed', message: messageIn(result.stderr) }
  } catch (cause) {
    return { kind: 'unavailable', message: `The homingbird command could not be started: ${describe(cause)}` }
  }
}

export async function runJson($: BundleFinder, target: CliTarget, args: ReadonlyArray<string>): Promise<Ran> {
  const ran = await run($, target, [...args, '--json'])
  return ran.kind === 'ok' ? { ...ran, value: lastJsonLine(ran.text) } : ran
}

/** How to start the command line, worked out once per configuration and kept for the session. */
export function commandOf($: BundleFinder, options: PluginOptions): Promise<Command> {
  const known = RESOLVED.get(options)
  if (known !== undefined) return known
  const resolving = resolveCommand($, options)
  RESOLVED.set(options, resolving)
  return resolving
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

/** Where the mod's settings are; the host does not tell a mod its marketplace, so no plugin id is named. */
export const CONFIGURE_COMMAND = 'the Homingbird plugin settings (/plugin)'

const RUN_TIMEOUT_MS = 60_000
const VERSION_TIMEOUT_MS = 10_000
const RESOLVED = new WeakMap<PluginOptions, Promise<Command>>()

async function resolveCommand($: BundleFinder, options: PluginOptions): Promise<Command> {
  const configured = configuredCommandOf(options)
  const bundled = `${$.plugin.root}/${BUNDLED_CLI}`
  const hasBundle = await isFile($, bundled)
  if (configured.length > 1 || (configured.length === 1 && !isNodePath(configured[0]!)))
    return { kind: 'ready', argv: configured }
  const node = configured.length === 1 ? await nodeAt($, configured[0]!) : await findNode($)
  if (node.kind === 'no-node') return node
  // messageIn shows the first line of stderr, so a Node warning there would hide the command's own error.
  if (hasBundle) return { kind: 'ready', argv: [node.path, '--no-warnings', bundled] }
  const npx = node.path === 'node' ? 'npx' : node.path.replace(/node(\.exe)?$/, 'npx$1')
  return (await versionOf($, npx)) === null
    ? { kind: 'no-node', olderVersion: null }
    : { kind: 'ready', argv: [npx, ...DEFAULT_COMMAND.split(' ').slice(1)] }
}

type FoundNode = { readonly kind: 'found'; readonly path: string } | Extract<Command, { kind: 'no-node' }>

async function findNode($: BundleFinder): Promise<FoundNode> {
  let older: string | null = null
  for (const candidate of await nodeCandidates($)) {
    const found = await nodeAt($, candidate)
    if (found.kind === 'found') return found
    older ??= found.olderVersion
  }
  return { kind: 'no-node', olderVersion: older }
}

async function nodeAt($: BundleFinder, path: string): Promise<FoundNode> {
  if (path.includes('/') && !(await $.fs.exists(path).catch(() => false)))
    return { kind: 'no-node', olderVersion: null }
  const version = await versionOf($, path)
  if (version === null) return { kind: 'no-node', olderVersion: null }
  return majorOf(version) >= MINIMUM_NODE_MAJOR
    ? { kind: 'found', path }
    : { kind: 'no-node', olderVersion: version }
}

async function nodeCandidates($: BundleFinder): Promise<string[]> {
  const home = (await $.env.get('HOME')) ?? ''
  const nvm = (await $.env.get('NVM_DIR')) || `${home}/.nvm`
  const fnm = (await $.env.get('FNM_DIR')) || `${home}/.local/share/fnm`
  return [
    'node',
    ...(await nvmNodes($, `${nvm}/versions/node`)),
    `${home}/.volta/bin/node`,
    `${home}/.asdf/shims/node`,
    `${fnm}/aliases/default/bin/node`,
    `${home}/Library/Application Support/fnm/aliases/default/bin/node`,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ]
}

async function nvmNodes($: BundleFinder, versions: string): Promise<string[]> {
  const entries = await $.fs.list(versions).catch(() => [])
  return entries
    .filter((entry) => entry.kind === 'dir' && majorOf(entry.name) >= MINIMUM_NODE_MAJOR)
    .map((entry) => entry.name)
    .sort(newestFirst)
    .map((name) => `${versions}/${name}/bin/node`)
}

async function versionOf($: BundleFinder, executable: string): Promise<string | null> {
  try {
    const result = await $.process.run([executable, '--version'], { timeoutMs: VERSION_TIMEOUT_MS })
    const version = result.stdout.trim()
    return result.exitCode === 0 && /^v?\d+\./.test(version) ? version : null
  } catch {
    return null
  }
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
    ? `Node ${MINIMUM_NODE_MAJOR} or newer was not found, so the homingbird command cannot run. Start Claude Code from a shell where node -v works, or set the mod's Homingbird command to the full path of node in ${CONFIGURE_COMMAND}.`
    : `Node ${olderVersion} is too old; the homingbird command needs Node ${MINIMUM_NODE_MAJOR} or newer. Start Claude Code from a shell where node -v shows ${MINIMUM_NODE_MAJOR} or newer, or set the mod's Homingbird command to the full path of a newer node in ${CONFIGURE_COMMAND}.`
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

async function isFile($: BundleFinder, path: string): Promise<boolean> {
  try {
    return (await $.fs.stat(path)).kind === 'file'
  } catch {
    return false
  }
}

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))
