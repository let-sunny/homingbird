import { tagged } from '@homingbird/kernel'
import type { ApiError } from '@homingbird/protocol'

export const CliFailure = tagged('CliFailure')<{ readonly message: string; readonly exitCode: number }>()
export type CliFailure = ReturnType<typeof CliFailure>

export const EXIT = { failed: 1, usage: 2, signedOut: 3, unsafe: 4 } as const

export const failed = (message: string): CliFailure => CliFailure({ message, exitCode: EXIT.failed })

export const fromApiError = (error: ApiError): CliFailure =>
  error._tag === 'Unauthorized'
    ? CliFailure({ message: SIGNED_OUT_MESSAGE, exitCode: EXIT.signedOut })
    : CliFailure({ message: error.message, exitCode: EXIT.failed })

export const SIGNED_OUT_MESSAGE = 'Not signed in. Run `homingbird login --server <url>` first.'
