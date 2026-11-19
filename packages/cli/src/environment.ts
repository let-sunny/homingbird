import type { Fetch } from '@homingbird/client'
import type { HasClock } from '@homingbird/kernel'

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
  readonly platform: string
  /** How to start this command line again, such as the Node executable and the script. */
  readonly program: ReadonlyArray<string>
  readonly userId: number | null
  /** The server this command was told to use, with --server or HOMINGBIRD_SERVER. */
  readonly server: string | null
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
  /** Runs a program directly, without a shell, and collects what it printed. */
  readonly run: (program: string, args: ReadonlyArray<string>) => Promise<ProcessRun>
}

export interface ProcessRun {
  readonly exitCode: number | null
  readonly output: string
}

export interface AgentRun {
  readonly exitCode: number | null
  readonly output: string
}

export interface Files {
  readonly read: (path: string) => Promise<string | null>
  readonly exists: (path: string) => Promise<boolean>
  readonly writePrivate: (path: string, content: string) => Promise<void>
  /** Writes a file only its owner can read, in a directory it may share: existing directories keep their mode. */
  readonly writeOwnerOnly: (path: string, content: string) => Promise<void>
  /** Writes a private file only when none exists; false when one does. */
  readonly createExclusive: (path: string, content: string) => Promise<boolean>
  readonly remove: (path: string) => Promise<void>
  /** The names of the files directly in a directory; none when it does not exist. */
  readonly list: (directory: string) => Promise<string[]>
}

export interface Output {
  readonly line: (text: string) => void
  readonly problem: (text: string) => void
}

export const PRIVATE_FILE_MODE = 0o600
export const PRIVATE_DIRECTORY_MODE = 0o700
