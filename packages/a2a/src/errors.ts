import type { ApiError } from '@homingbird/protocol'
import { RPC_CODE, RpcFailure } from './json-rpc.ts'

export const A2A_CODE = {
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  pushNotificationNotSupported: -32003,
  unsupportedOperation: -32004,
  contentTypeNotSupported: -32005,
} as const

export const rpcFailureOf = (error: ApiError | RpcFailure): RpcFailure =>
  error._tag === 'RpcFailure' ? error : RpcFailure({ code: CODE_FOR[error._tag], message: error.message })

const CODE_FOR: Readonly<Record<ApiError['_tag'], number>> = {
  Invalid: RPC_CODE.invalidParams,
  NotFound: RPC_CODE.invalidParams,
  Conflict: RPC_CODE.invalidRequest,
  Forbidden: RPC_CODE.invalidRequest,
  Unauthorized: RPC_CODE.invalidRequest,
  RateLimited: RPC_CODE.invalidRequest,
  Unavailable: RPC_CODE.internalError,
}
