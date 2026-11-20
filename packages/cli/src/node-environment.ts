import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants, appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { dirname } from 'node:path'
import { Task as T, systemClock } from '@homingbird/kernel'
import {
  type CliEnv,
  type Files,
  type Output,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  type Processes,
  type Programs,
} from './environment.ts'
import { type AgentErrors, nodeLauncher, taskkillCommand } from './node-launcher.ts'

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
  programs: nodePrograms,
  platform: process.platform,
  program: commandLineProgram(process.execPath, process.argv),
  userId: process.getuid?.() ?? null,
  server: null,
  credentialsFile: null,
})

export interface NodeEnvironmentOptions {
  readonly agentErrors?: AgentErrors
  /** Where the background service writes its output where the platform cannot redirect it, as on Windows. */
  readonly logFile?: string | null
}

/**
 * Appends each line as it is written, so that lines stay in order and survive a crash. A file past
 * 5 MB becomes the one backup, `<path>.1`, replacing the one before, so a looping service cannot fill
 * a disk.
 */
export const logFileOutput = (path: string, maxBytes = LOG_FILE_MAX_BYTES): Output => {
  mkdirSync(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  const append = (text: string): void => {
    if (sizeOf(path) >= maxBytes) renameSync(path, `${path}.1`)
    appendFileSync(path, `${text}\n`, { mode: PRIVATE_FILE_MODE })
  }
  return { line: append, problem: append }
}

export const LOG_FILE_MAX_BYTES = 5 * 1024 * 1024

const sizeOf = (path: string): number => {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
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

const PROCESS_TIMEOUT_MS = 30_000

export const nodeFiles: Files = {
  read: (path) => T.catchAll(() => T.succeed(null))(T.tryPromise(() => readFile(path, 'utf8'), asCause)),
  exists: (path) =>
    T.promise(() =>
      access(path).then(
        () => true,
        () => false,
      ),
    ),
  writePrivate: (path, content) =>
    T.gen(function* () {
      yield* T.promise(() => mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE }))
      yield* T.promise(() => chmod(dirname(path), PRIVATE_DIRECTORY_MODE))
      yield* T.promise(() => writeFile(path, content, { mode: PRIVATE_FILE_MODE }))
      yield* T.promise(() => chmod(path, PRIVATE_FILE_MODE))
    }),
  writeOwnerOnly: (path, content) =>
    T.gen(function* () {
      yield* T.promise(() => mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE }))
      const fresh = `${path}.${randomBytes(6).toString('hex')}.tmp`
      try {
        yield* T.promise(() => writeFile(fresh, '', { mode: PRIVATE_FILE_MODE, flag: 'wx' }))
        yield* T.promise(() => chmod(fresh, PRIVATE_FILE_MODE))
        yield* T.promise(() => writeFile(fresh, content))
        yield* T.promise(() => rename(fresh, path))
      } finally {
        yield* T.promise(() => rm(fresh, { force: true }))
      }
    }),
  createExclusive: (path, content) =>
    T.gen(function* () {
      yield* T.promise(() => mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE }))
      const written = yield* T.result(
        T.tryPromise(() => writeFile(path, content, { mode: PRIVATE_FILE_MODE, flag: 'wx' }), asCause),
      )
      if (written._tag === 'Ok') return true
      if ((written.error as NodeJS.ErrnoException).code === 'EEXIST') return false
      return yield* T.die(written.error)
    }),
  remove: (path) => T.promise(() => rm(path, { force: true })),
  mode: (path) =>
    T.promise(() =>
      stat(path).then(
        (found) => found.mode & PERMISSION_BITS,
        () => null,
      ),
    ),
  isWritable: (path) =>
    T.gen(function* () {
      if (!(yield* isAccessible(path, constants.W_OK))) return false
      return yield* isAccessible(dirname(path), constants.W_OK)
    }),
  list: (directory) => T.promise(() => readdir(directory).catch(() => [])),
}

const isAccessible = (path: string, mode: number): T.Task<boolean> =>
  T.promise(() =>
    access(path, mode).then(
      () => true,
      () => false,
    ),
  )

const asCause = (cause: unknown): unknown => cause

const PERMISSION_BITS = 0o777

const nodeProcesses: Processes = {
  run: (program, args, options = {}) =>
    new Promise((resolve) => {
      const child = execFile(
        program,
        [...args],
        {
          timeout: options.timeoutMs ?? PROCESS_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          windowsHide: true,
          encoding: 'utf8',
          ...(options.environment !== undefined && { env: { ...options.environment } }),
          ...(options.windowsVerbatimArguments === true && { windowsVerbatimArguments: true }),
          ...(options.signal !== undefined && { signal: options.signal }),
        },
        (error, stdout, stderr) => {
          const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : null
          resolve({
            exitCode,
            output: `${stdout}${stderr}${exitCode === null ? (error?.message ?? '') : ''}`,
          })
        },
      )
      if (process.platform === 'win32')
        options.signal?.addEventListener('abort', () => endTree(child.pid), { once: true })
    }),
}

/** Node's own stop reaches only cmd.exe on Windows; taskkill also ends what it started. */
const endTree = (pid: number | undefined): void => {
  if (pid === undefined) return
  const [program, args] = taskkillCommand(process.env.SystemRoot ?? 'C:\\Windows', pid)
  execFile(program, args, { windowsHide: true }, () => {})
}

const nodePrograms: Programs = {
  realPath: (path) =>
    realpath(path).then(
      (real) => real,
      () => null,
    ),
  isRunnable: (path) =>
    access(path, constants.X_OK)
      .then(() => stat(path))
      .then(
        (found) => found.isFile(),
        () => false,
      ),
}
