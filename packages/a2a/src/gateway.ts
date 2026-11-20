import { Task as T } from '@homingbird/kernel'
import { type Api, type ApiError, type AsRead, NoteId } from '@homingbird/protocol'
import { CURRENT, type Dialect, LEGACY } from './dialect.ts'
import { draftFromMessage } from './draft-from-message.ts'
import { A2A_CODE, rpcFailureOf } from './errors.ts'
import { RPC_CODE, type RpcCall, RpcFailure, methodNotFound, serveJsonRpc } from './json-rpc.ts'
import { type MemberApi, memberApiOf } from './member-api.ts'
import { type ViewContext, taskViewOf } from './task-view.ts'
import { SUPPORTED, requestedVersionOf } from './version.ts'

export interface A2aContext {
  readonly api: Api
  readonly publicUrl: string
  readonly nonce: () => string
}

export const handleA2aMessage = (
  message: unknown,
  context: A2aContext,
  versionHeader: string | undefined,
): T.Task<unknown> =>
  Array.isArray(message)
    ? T.succeed(BATCH_REFUSED)
    : serveJsonRpc((call) => negotiate(call, versionHeader, { ...context, api: memberApiOf(context.api) }))(
        message,
      )

type Operation = 'send' | 'get' | 'cancel' | 'unsupported' | 'push'

interface Method {
  readonly operation: Operation
  readonly dialect: Dialect
}

const METHODS: Readonly<Record<string, Method>> = {
  SendMessage: { operation: 'send', dialect: CURRENT },
  GetTask: { operation: 'get', dialect: CURRENT },
  CancelTask: { operation: 'cancel', dialect: CURRENT },
  SendStreamingMessage: { operation: 'unsupported', dialect: CURRENT },
  SubscribeToTask: { operation: 'unsupported', dialect: CURRENT },
  ListTasks: { operation: 'unsupported', dialect: CURRENT },
  GetExtendedAgentCard: { operation: 'unsupported', dialect: CURRENT },
  CreateTaskPushNotificationConfig: { operation: 'push', dialect: CURRENT },
  GetTaskPushNotificationConfig: { operation: 'push', dialect: CURRENT },
  ListTaskPushNotificationConfigs: { operation: 'push', dialect: CURRENT },
  DeleteTaskPushNotificationConfig: { operation: 'push', dialect: CURRENT },
  'message/send': { operation: 'send', dialect: LEGACY },
  'tasks/get': { operation: 'get', dialect: LEGACY },
  'tasks/cancel': { operation: 'cancel', dialect: LEGACY },
  'message/stream': { operation: 'unsupported', dialect: LEGACY },
  'tasks/resubscribe': { operation: 'unsupported', dialect: LEGACY },
  'tasks/pushNotificationConfig/set': { operation: 'push', dialect: LEGACY },
  'tasks/pushNotificationConfig/get': { operation: 'push', dialect: LEGACY },
  'tasks/pushNotificationConfig/list': { operation: 'push', dialect: LEGACY },
  'tasks/pushNotificationConfig/delete': { operation: 'push', dialect: LEGACY },
}

const BATCH_REFUSED = {
  jsonrpc: '2.0',
  id: null,
  error: { code: RPC_CODE.invalidRequest, message: 'Invalid Request: batches are not supported' },
}

const negotiate = (
  call: RpcCall,
  versionHeader: string | undefined,
  context: ViewContext,
): T.Task<unknown, RpcFailure> => {
  const requested = requestedVersionOf(versionHeader)
  const method = Object.hasOwn(METHODS, call.method) ? METHODS[call.method] : undefined
  if (requested.kind === 'unsupported')
    return T.fail(
      rpcFailureOf(CURRENT)(
        versionNotSupported(`A2A-Version ${requested.version} is not supported. ${SUPPORTED_SENTENCE}`),
      ),
    )
  if (method === undefined)
    return T.fail(
      rpcFailureOf(requested.kind === 'supported' ? requested.dialect : LEGACY)(methodNotFound(call.method)),
    )
  if (requested.kind === 'supported' && requested.dialect !== method.dialect)
    return T.fail(
      rpcFailureOf(requested.dialect)(
        versionNotSupported(
          `${call.method} is an A2A ${method.dialect.version} method, but the request names A2A-Version ${requested.dialect.version}.`,
        ),
      ),
    )
  return T.mapError(rpcFailureOf(method.dialect))(answer(call, method, context))
}

const answer = (
  call: RpcCall,
  { operation, dialect }: Method,
  context: ViewContext,
): T.Task<unknown, RpcFailure | ApiError> => {
  if (operation === 'unsupported')
    return T.fail(
      RpcFailure({
        code: A2A_CODE.unsupportedOperation,
        message: `${call.method} is not supported by this agent.`,
      }),
    )
  if (operation === 'push')
    return T.fail(
      RpcFailure({
        code: A2A_CODE.pushNotificationNotSupported,
        message: 'Push notifications are not supported.',
      }),
    )
  if (operation === 'send')
    return T.gen(function* () {
      const draft = yield* draftFromMessage(call.params, context.api)
      return dialect.sendResult(yield* taskViewOf(draft, context))
    })
  return T.gen(function* () {
    const note = yield* taskNote(call.params.id, context.api)
    if (operation === 'cancel')
      return yield* T.fail(
        RpcFailure({
          code: A2A_CODE.taskNotCancelable,
          message:
            "An agent cannot cancel this task. Only the member's human can discard a draft, in Homingbird.",
        }),
      )
    return dialect.task(yield* taskViewOf(note, context))
  })
}

const versionNotSupported = (message: string): RpcFailure =>
  RpcFailure({ code: A2A_CODE.versionNotSupported, message })

const SUPPORTED_SENTENCE = `Send A2A-Version ${SUPPORTED.map((dialect) => dialect.version).join(' or ')}.`

const taskNote = (id: unknown, api: MemberApi): T.Task<AsRead.Note, RpcFailure | ApiError> => {
  const noteId = NoteId.decode(id)
  const unknownTask = RpcFailure({ code: A2A_CODE.taskNotFound, message: `Task not found: ${String(id)}` })
  return noteId._tag === 'Err'
    ? T.fail(unknownTask)
    : T.mapError(() => unknownTask)(api['notes.get']({ params: { id: noteId.value } }))
}
