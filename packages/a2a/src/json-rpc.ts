import { Task as T, tagged } from '@homingbird/kernel'

export type RpcId = string | number | null

export interface RpcCall {
  readonly method: string
  readonly params: Readonly<Record<string, unknown>>
}

export const RpcFailure = tagged('RpcFailure')<{
  readonly code: number
  readonly message: string
  readonly data?: unknown
}>()
export type RpcFailure = ReturnType<typeof RpcFailure>

export type RpcHandler = (call: RpcCall) => T.Task<unknown, RpcFailure>

export const RPC_CODE = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const

export const serveJsonRpc =
  (handler: RpcHandler) =>
  (message: unknown): T.Task<unknown | null> =>
    Array.isArray(message) ? answerBatch(handler, message) : answerOne(handler, message)

export const methodNotFound = (method: string): RpcFailure =>
  RpcFailure({ code: RPC_CODE.methodNotFound, message: `Method not found: ${method}` })

export const invalidParams = (message: string): RpcFailure =>
  RpcFailure({ code: RPC_CODE.invalidParams, message })

const answerBatch = (handler: RpcHandler, messages: ReadonlyArray<unknown>): T.Task<unknown | null> =>
  messages.length === 0
    ? T.succeed(failure(null, RPC_CODE.invalidRequest, 'Invalid Request: an empty batch'))
    : T.map((answers: ReadonlyArray<unknown | null>) => {
        const replies = answers.filter((answer) => answer !== null)
        return replies.length === 0 ? null : replies
      })(T.forEach(messages, (message) => answerOne(handler, message)))

const answerOne = (handler: RpcHandler, message: unknown): T.Task<unknown | null> => {
  const envelope = envelopeOf(message)
  if (envelope.kind === 'response') return T.succeed(null)
  if (envelope.kind === 'invalid')
    return T.succeed(failure(envelope.id, RPC_CODE.invalidRequest, 'Invalid Request'))
  const outcome = T.exit(handler({ method: envelope.method, params: envelope.params }))
  if (envelope.kind === 'notification') return T.as(null)(outcome)
  return T.map((exit: T.Exit<unknown, RpcFailure>) => {
    if (exit._tag === 'Ok') return { jsonrpc: '2.0', id: envelope.id, result: exit.value }
    return exit.error._tag === 'Fail'
      ? failure(envelope.id, exit.error.error.code, exit.error.error.message, exit.error.error.data)
      : failure(envelope.id, RPC_CODE.internalError, 'Internal error')
  })(outcome)
}

type Envelope =
  | {
      readonly kind: 'request'
      readonly id: RpcId
      readonly method: string
      readonly params: RpcCall['params']
    }
  | { readonly kind: 'notification'; readonly method: string; readonly params: RpcCall['params'] }
  | { readonly kind: 'response' }
  | { readonly kind: 'invalid'; readonly id: RpcId }

const envelopeOf = (message: unknown): Envelope => {
  if (!isRecord(message)) return { kind: 'invalid', id: null }
  const id = isRpcId(message.id) ? message.id : null
  const hasId = 'id' in message
  if (message.jsonrpc !== '2.0' || (hasId && !isRpcId(message.id))) return { kind: 'invalid', id }
  if (typeof message.method !== 'string')
    return hasId && ('result' in message || 'error' in message)
      ? { kind: 'response' }
      : { kind: 'invalid', id }
  if (message.params !== undefined && !isRecord(message.params)) return { kind: 'invalid', id }
  const call = { method: message.method, params: message.params ?? {} }
  return hasId ? { kind: 'request', id, ...call } : { kind: 'notification', ...call }
}

const failure = (id: RpcId, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, ...(data !== undefined && { data }) },
})

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRpcId = (value: unknown): value is RpcId =>
  typeof value === 'string' || typeof value === 'number' || value === null
