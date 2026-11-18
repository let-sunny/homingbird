import type { EngineInterface, PluginOptions } from 'claude-code'

export type Engine = Pick<EngineInterface, 'process' | 'plugin' | 'fs'>

export type BundleFinder = {
  readonly plugin: Pick<EngineInterface['plugin'], 'root'>
  readonly fs: Pick<EngineInterface['fs'], 'stat'>
}

export type Ran =
  | { readonly kind: 'ok'; readonly value: unknown; readonly text: string }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'unsupported'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string }

export async function run($: Engine, options: PluginOptions, args: ReadonlyArray<string>): Promise<Ran> {
  try {
    const command = await commandOf($, options)
    const result = await $.process.run([...command, ...args], { timeoutMs: RUN_TIMEOUT_MS })
    if (result.exitCode === 0) return { kind: 'ok', value: null, text: result.stdout.trim() }
    if (result.exitCode === EXIT_SIGNED_OUT) return { kind: 'signed-out' }
    if (result.exitCode === EXIT_USAGE) return { kind: 'unsupported', message: messageIn(result.stderr) }
    return { kind: 'failed', message: messageIn(result.stderr) }
  } catch (cause) {
    return { kind: 'unavailable', message: `The homingbird command could not be started: ${describe(cause)}` }
  }
}

export async function runJson($: Engine, options: PluginOptions, args: ReadonlyArray<string>): Promise<Ran> {
  const ran = await run($, options, [...args, '--json'])
  return ran.kind === 'ok' ? { ...ran, value: lastJsonLine(ran.text) } : ran
}

export async function commandOf($: BundleFinder, options: PluginOptions): Promise<string[]> {
  const configured = configuredCommandOf(options)
  if (configured.length > 0) return configured
  const bundled = `${$.plugin.root}/${BUNDLED_CLI}`
  // messageIn shows the first line of stderr, so a Node warning there would hide the command's own error.
  return (await isFile($, bundled)) ? ['node', '--no-warnings', bundled] : DEFAULT_COMMAND.split(' ')
}

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

const RUN_TIMEOUT_MS = 60_000
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
