import { Task as T } from '@homingbird/kernel'
import type { Api } from '@homingbird/protocol'

export interface A2aContext {
  readonly api: Api
  readonly publicUrl: string
  readonly nonce: () => string
}

export const handleA2aMessage = (_message: unknown, _context: A2aContext): T.Task<unknown> => T.succeed(null)

export const agentCard = (publicUrl: string, version: string): unknown => ({
  url: `${publicUrl}/a2a`,
  version,
})
