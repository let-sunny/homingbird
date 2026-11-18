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

export interface AgentRun {
  readonly exitCode: number | null
  readonly output: string
}

export interface Files {
  readonly read: (path: string) => Promise<string | null>
  readonly exists: (path: string) => Promise<boolean>
  readonly writePrivate: (path: string, content: string) => Promise<void>
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
