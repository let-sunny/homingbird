import type { ApiError } from '@homingbird/protocol'
import type { Dialect } from './dialect.ts'
import { RPC_CODE, RpcFailure } from './json-rpc.ts'

export const A2A_CODE = {
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  pushNotificationNotSupported: -32003,
  unsupportedOperation: -32004,
  contentTypeNotSupported: -32005,
  invalidAgentResponse: -32006,
  extendedAgentCardNotConfigured: -32007,
  extensionSupportRequired: -32008,
  versionNotSupported: -32009,
} as const

export const rpcFailureOf =
  (dialect: Dialect) =>
  (error: ApiError | RpcFailure): RpcFailure => {
    const failure =
      error._tag === 'RpcFailure' ? error : RpcFailure({ code: CODE_FOR[error._tag], message: error.message })
    const reason = REASON_FOR.get(failure.code)
    return dialect.version === '1.0' && reason !== undefined
      ? RpcFailure({ ...failure, data: [{ '@type': ERROR_INFO_TYPE, reason, domain: A2A_DOMAIN }] })
      : failure
  }

const CODE_FOR: Readonly<Record<ApiError['_tag'], number>> = {
  Invalid: RPC_CODE.invalidParams,
  NotFound: RPC_CODE.invalidParams,
  Conflict: RPC_CODE.invalidRequest,
  Forbidden: RPC_CODE.invalidRequest,
  Unauthorized: RPC_CODE.invalidRequest,
  RateLimited: RPC_CODE.invalidRequest,
  Unavailable: RPC_CODE.internalError,
}

const REASON_FOR: ReadonlyMap<number, string> = new Map([
  [A2A_CODE.taskNotFound, 'TASK_NOT_FOUND'],
  [A2A_CODE.taskNotCancelable, 'TASK_NOT_CANCELABLE'],
  [A2A_CODE.pushNotificationNotSupported, 'PUSH_NOTIFICATION_NOT_SUPPORTED'],
  [A2A_CODE.unsupportedOperation, 'UNSUPPORTED_OPERATION'],
  [A2A_CODE.contentTypeNotSupported, 'CONTENT_TYPE_NOT_SUPPORTED'],
  [A2A_CODE.invalidAgentResponse, 'INVALID_AGENT_RESPONSE'],
  [A2A_CODE.extendedAgentCardNotConfigured, 'EXTENDED_AGENT_CARD_NOT_CONFIGURED'],
  [A2A_CODE.extensionSupportRequired, 'EXTENSION_SUPPORT_REQUIRED'],
  [A2A_CODE.versionNotSupported, 'VERSION_NOT_SUPPORTED'],
])

const ERROR_INFO_TYPE = 'type.googleapis.com/google.rpc.ErrorInfo'

const A2A_DOMAIN = 'a2a-protocol.org'
