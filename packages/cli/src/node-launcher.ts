import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process'
import type { AgentRun, Launcher } from './environment.ts'

export type Spawn = (command: string, args: ReadonlyArray<string>, options: SpawnOptions) => ChildProcess

export const nodeLauncher = (platform: string, start: Spawn = spawn): Launcher => ({
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
  runAgent: (command, prompt, signal) =>
    new Promise<AgentRun>((resolve, reject) => {
      const child = start(command, [], { stdio: ['pipe', 'pipe', 'inherit'], shell: true, signal })
      const chunks: Buffer[] = []
      let size = 0
      child.stdout?.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size <= AGENT_OUTPUT_MAX_BYTES) chunks.push(chunk)
      })
      child.stdin?.on('error', () => {})
      child.once('error', reject)
      child.once('close', (exitCode) => resolve({ exitCode, output: Buffer.concat(chunks).toString('utf8') }))
      child.stdin?.end(prompt)
    }),
})

export const openerCommand = (platform: string, url: string): string[] =>
  platform === 'darwin'
    ? ['open', url]
    : platform === 'win32'
      ? ['rundll32', 'url.dll,FileProtocolHandler', url]
      : ['xdg-open', url]

export const AGENT_OUTPUT_MAX_BYTES = 1_000_000

const isWebAddress = (url: string): boolean =>
  URL.canParse(url) && ['http:', 'https:'].includes(new URL(url).protocol)
