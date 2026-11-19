import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { access, chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { dirname } from 'node:path'
import { systemClock } from '@homingbird/kernel'
import {
  type CliEnv,
  type Files,
  type Output,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  type Processes,
} from './environment.ts'
import { type AgentErrors, nodeLauncher } from './node-launcher.ts'

export const nodeEnvironment = (stopped: AbortSignal, options: NodeEnvironmentOptions = {}): CliEnv => ({
  clock: systemClock,
  fetch: globalThis.fetch,
  files: nodeFiles,
  output: options.logFile ? logFileOutput(options.logFile) : terminalOutput,
  variables: process.env,
  homeDirectory: homedir(),
  hostName: hostname(),
  nonce: () => randomBytes(16).toString('hex'),
  stopped,
  launcher: nodeLauncher(process.platform, undefined, undefined, options.agentErrors ?? 'inherit'),
  processes: nodeProcesses,
  platform: process.platform,
  program: commandLineProgram(process.execPath, process.argv),
  userId: process.getuid?.() ?? null,
  server: null,
})

export interface NodeEnvironmentOptions {
  readonly agentErrors?: AgentErrors
  /** Where the background service writes its output where the platform cannot redirect it, as on Windows. */
  readonly logFile?: string | null
}

/** Appends each line as it is written, so that lines stay in order and survive a crash. */
export const logFileOutput = (path: string): Output => {
  mkdirSync(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  const append = (text: string): void => appendFileSync(path, `${text}\n`, { mode: PRIVATE_FILE_MODE })
  return { line: append, problem: append }
}

const terminalOutput: Output = {
  line: (text) => void process.stdout.write(`${text}\n`),
  problem: (text) => void process.stderr.write(`${text}\n`),
}

/** The Node executable and this script only: options Node itself was started with, such as --inspect, stay out. */
export const commandLineProgram = (executable: string, argv: ReadonlyArray<string>): string[] => [
  executable,
  ...(argv[1] === undefined ? [] : [argv[1]]),
]

export const nodeProcesses: Processes = {
  run: (program, args) =>
    new Promise((resolve) => {
      execFile(
        program,
        [...args],
        { timeout: PROCESS_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
        (error, stdout, stderr) => {
          const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : null
          resolve({
            exitCode,
            output: `${stdout}${stderr}${exitCode === null ? (error?.message ?? '') : ''}`,
          })
        },
      )
    }),
}

const PROCESS_TIMEOUT_MS = 30_000

export const nodeFiles: Files = {
  read: async (path) => {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return null
    }
  },
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  writePrivate: async (path, content) => {
    await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    await chmod(dirname(path), PRIVATE_DIRECTORY_MODE)
    await writeFile(path, content, { mode: PRIVATE_FILE_MODE })
    await chmod(path, PRIVATE_FILE_MODE)
  },
  writeOwnerOnly: async (path, content) => {
    await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    await writeFile(path, content, { mode: PRIVATE_FILE_MODE })
    await chmod(path, PRIVATE_FILE_MODE)
  },
  createExclusive: async (path, content) => {
    await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    try {
      await writeFile(path, content, { mode: PRIVATE_FILE_MODE, flag: 'wx' })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    }
  },
  remove: (path) => rm(path, { force: true }),
  list: (directory) => readdir(directory).catch(() => []),
}
