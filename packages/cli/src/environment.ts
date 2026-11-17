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
}

export interface Files {
  readonly read: (path: string) => Promise<string | null>
  readonly writePrivate: (path: string, content: string) => Promise<void>
  readonly remove: (path: string) => Promise<void>
}

export interface Output {
  readonly line: (text: string) => void
  readonly problem: (text: string) => void
}

export const PRIVATE_FILE_MODE = 0o600
export const PRIVATE_DIRECTORY_MODE = 0o700
