import { Task as T } from '@homingbird/kernel'
import type { ApiError } from '@homingbird/protocol'

export const MISSING = 'missing' as const

export const orMissing = <A, R>(task: T.Task<A, ApiError, R>): T.Task<A | typeof MISSING, ApiError, R> =>
  T.catchAll(
    (error: ApiError): T.Task<typeof MISSING, ApiError> =>
      error._tag === 'NotFound' ? T.succeed(MISSING) : T.fail(error),
  )(task)
