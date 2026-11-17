import { Task as T } from '@homingbird/kernel'
import type { Api } from '@homingbird/protocol'

export interface McpContext {
  readonly api: Api
  readonly serverVersion: string
  readonly nonce: () => string
}

export const handleMcpMessage = (_message: unknown, _context: McpContext): T.Task<unknown | null> =>
  T.succeed(null)
