import type { EngineInterface, PluginOptions } from 'claude-code'

export type Engine = Pick<EngineInterface, 'process'>

export type Ran =
  | { readonly kind: 'ok'; readonly value: unknown; readonly text: string }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string }

export const DEFAULT_COMMAND = 'npx -y @homingbird/cli'

export const commandOf = (options: PluginOptions): string[] => {
  const words = String(options.command ?? '').trim().split(/\s+/).filter((word) => word !== '')
  return words.length > 0 ? words : DEFAULT_COMMAND.split(' ')
}

export async function runJson($: Engine, options: PluginOptions, args: ReadonlyArray<string>): Promise<Ran> {
  const ran = await run($, options, [...args, '--json'])
  return ran.kind === 'ok' ? { ...ran, value: lastJsonLine(ran.text) } : ran
}

export async function run($: Engine, options: PluginOptions, args: ReadonlyArray<string>): Promise<Ran> {
  try {
    const result = await $.process.run([...commandOf(options), ...args], { timeoutMs: RUN_TIMEOUT_MS })
    if (result.exitCode === 0) return { kind: 'ok', value: null, text: result.stdout.trim() }
    if (result.exitCode === SIGNED_OUT_EXIT_CODE) return { kind: 'signed-out' }
    return { kind: 'failed', message: messageIn(result.stderr) }
  } catch (cause) {
    return { kind: 'unavailable', message: `The homingbird command could not be started: ${describe(cause)}` }
  }
}

export const lastJsonLine = (text: string): unknown => {
  const line = text.trim().split('\n').at(-1) ?? ''
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

const RUN_TIMEOUT_MS = 60_000
const SIGNED_OUT_EXIT_CODE = 3

const messageIn = (stderr: string): string => {
  const parsed = lastJsonLine(stderr)
  const message = typeof parsed === 'object' && parsed !== null ? (parsed as { error?: unknown }).error : undefined
  return typeof message === 'string' ? message : stderr.trim().split('\n')[0] || 'The homingbird command failed.'
}

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))
