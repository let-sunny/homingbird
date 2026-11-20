import type { Fetch } from '@homingbird/client'
import type { HasClock, Task as T } from '@homingbird/kernel'

export interface CliEnv extends HasClock {
  readonly fetch: Fetch
  readonly files: Files
  readonly output: Output
  readonly variables: Readonly<Record<string, string | undefined>>
  readonly homeDirectory: string
  readonly hostName: string
  readonly nonce: () => string
  readonly stopped: AbortSignal
  readonly launcher: Launcher
  readonly processes: Processes
  readonly programs: Programs
  readonly platform: string
  /** How to start this command line again, such as the Node executable and the script. */
  readonly program: ReadonlyArray<string>
  readonly userId: number | null
  /** The server this command was told to use, with --server or HOMINGBIRD_SERVER. */
  readonly server: string | null
  /** The one file to read the agent credential from, with --credentials-file or HOMINGBIRD_CREDENTIALS_FILE. */
  readonly credentialsFile: string | null
}

export interface Launcher {
  readonly openInBrowser: (url: string) => Promise<boolean>
  readonly runAgent: (
    command: string,
    prompt: string,
    environment: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ) => Promise<AgentRun>
}

export interface Processes {
  /** Runs a program directly, without a shell, and collects what it printed; one that runs too long is stopped. */
  readonly run: (
    program: string,
    args: ReadonlyArray<string>,
    options?: ProcessOptions,
  ) => Promise<ProcessRun>
}

export interface ProcessOptions {
  readonly timeoutMs?: number
  /** The whole environment the program runs with, instead of this process's own. */
  readonly environment?: Readonly<Record<string, string>>
  /** Stops the program, and on Windows everything it started. */
  readonly signal?: AbortSignal
  /** The arguments are one command line already quoted for cmd.exe. */
  readonly windowsVerbatimArguments?: boolean
}

export interface Programs {
  /** Where a path leads once every symbolic link is followed; null when nothing is there. */
  readonly realPath: (path: string) => Promise<string | null>
  /** Whether a file is there that this computer can run. */
  readonly isRunnable: (path: string) => Promise<boolean>
}

export interface ProcessRun {
  readonly exitCode: number | null
  readonly output: string
}

export interface AgentRun {
  readonly exitCode: number | null
  readonly output: string
  /** What the command wrote to its error output, never logged whole. */
  readonly errors?: string
}

export interface Files {
  readonly read: (path: string) => T.Task<string | null>
  readonly exists: (path: string) => T.Task<boolean>
  readonly writePrivate: (path: string, content: string) => T.Task<void>
  /** Writes a file only its owner can read, in a directory it may share: existing directories keep their mode. */
  readonly writeOwnerOnly: (path: string, content: string) => T.Task<void>
  /** Writes a private file only when none exists; false when one does. */
  readonly createExclusive: (path: string, content: string) => T.Task<boolean>
  readonly remove: (path: string) => T.Task<void>
  /** The permission bits of what is there, following links; null when nothing is. */
  readonly mode: (path: string) => T.Task<number | null>
  /** Whether this process may change the file and remove it from its directory. */
  readonly isWritable: (path: string) => T.Task<boolean>
  /** The names of the files directly in a directory; none when it does not exist. */
  readonly list: (directory: string) => T.Task<string[]>
}

export interface Output {
  readonly line: (text: string) => void
  readonly problem: (text: string) => void
}

export const PRIVATE_FILE_MODE = 0o600
export const PRIVATE_DIRECTORY_MODE = 0o700
