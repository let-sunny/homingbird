import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process'
import type { AgentRun, Launcher } from './environment.ts'
import { cmdCommand } from './windows-shell.ts'

export type Spawn = (command: string, args: ReadonlyArray<string>, options: SpawnOptions) => ChildProcess

export type Kill = (pid: number, signal: NodeJS.Signals) => void

/**
 * Runs each agent command as the leader of its own process group, so that stopping it also stops what
 * the shell started: nothing outlives the runner. Windows has no process groups to signal, so there
 * taskkill ends the command's whole process tree, and no console window opens for it.
 */
export const nodeLauncher = (
  platform: string,
  start: Spawn = spawn,
  kill: Kill = (pid, signal) => process.kill(pid, signal),
  agentErrors: AgentErrors = 'inherit',
  systemRoot: string = process.env.SystemRoot ?? 'C:\\Windows',
  writeError: (chunk: Buffer) => void = (chunk) => void process.stderr.write(chunk),
): Launcher => ({
  openInBrowser: (url) => {
    if (!isWebAddress(url)) return Promise.resolve(false)
    const [command, ...args] = openerCommand(platform, url)
    return new Promise<boolean>((resolve) => {
      const child = start(command!, args, { stdio: 'ignore', detached: true, shell: false })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    })
  },
  runAgent: (command, prompt, environment, signal) =>
    new Promise<AgentRun>((resolve, reject) => {
      const isWindows = platform === 'win32'
      const [program, args] = isWindows ? cmdCommand(systemRoot, command) : [command, []]
      const child = start(program, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: !isWindows,
        env: { ...environment },
        ...(isWindows ? { windowsHide: true, windowsVerbatimArguments: true } : { detached: true }),
      })
      const chunks: Buffer[] = []
      const errorChunks: Buffer[] = []
      let size = 0
      let errorSize = 0
      const stopGroup = (): void => {
        if (isWindows) stopProcessTree(child.pid, start, systemRoot)
        else stopProcessGroup(child.pid, kill)
        reject(new Error('The agent command was stopped.'))
      }
      if (signal.aborted) stopGroup()
      else signal.addEventListener('abort', stopGroup, { once: true })
      child.once('close', () => signal.removeEventListener('abort', stopGroup))
      child.stdout?.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size <= AGENT_OUTPUT_MAX_BYTES) chunks.push(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        if (agentErrors === 'inherit') writeError(chunk)
        errorSize += chunk.length
        if (errorSize <= AGENT_ERRORS_MAX_BYTES) errorChunks.push(chunk)
      })
      child.stdin?.on('error', () => {})
      child.once('error', reject)
      child.once('close', (exitCode) =>
        resolve({
          exitCode,
          output: Buffer.concat(chunks).toString('utf8'),
          errors: Buffer.concat(errorChunks).toString('utf8'),
        }),
      )
      child.stdin?.end(prompt)
    }),
})

/**
 * Where an agent's own error output goes, besides the runner, which reads it for a known refusal and
 * the first line of a failure: the terminal, or nowhere else for the service, whose log holds no note.
 */
export type AgentErrors = 'inherit' | 'ignore'

export const openerCommand = (platform: string, url: string): string[] =>
  platform === 'darwin'
    ? ['open', url]
    : platform === 'win32'
      ? ['rundll32', 'url.dll,FileProtocolHandler', url]
      : ['xdg-open', url]

export const AGENT_OUTPUT_MAX_BYTES = 1_000_000

export const AGENT_ERRORS_MAX_BYTES = 64_000

const isWebAddress = (url: string): boolean =>
  URL.canParse(url) && ['http:', 'https:'].includes(new URL(url).protocol)

/** taskkill ends the command and every process it started, which a kill of the shell alone would leave. */
export const taskkillCommand = (systemRoot: string, pid: number): [string, string[]] => [
  `${systemRoot}\\System32\\taskkill.exe`,
  ['/T', '/F', '/PID', String(pid)],
]

const stopProcessTree = (pid: number | undefined, start: Spawn, systemRoot: string): void => {
  if (pid === undefined) return
  const [program, args] = taskkillCommand(systemRoot, pid)
  try {
    start(program, args, { stdio: 'ignore', windowsHide: true, shell: false }).once('error', () => {})
  } catch {}
}

const stopProcessGroup = (pid: number | undefined, kill: Kill): void => {
  if (pid === undefined) return
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      kill(-pid, signal)
    } catch {}
  }
  signalGroup('SIGTERM')
  setTimeout(() => signalGroup('SIGKILL'), KILL_GRACE_MS).unref()
}

const KILL_GRACE_MS = 2_000
