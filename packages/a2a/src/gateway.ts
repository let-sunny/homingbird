import { Task as T } from '@homingbird/kernel'
import { type Api, type ApiError, type AsRead, NoteId } from '@homingbird/protocol'
import { CURRENT, type Dialect, LEGACY } from './dialect.ts'
import { draftFromMessage } from './draft-from-message.ts'
import { A2A_CODE, rpcFailureOf } from './errors.ts'
import { RPC_CODE, type RpcCall, RpcFailure, methodNotFound, serveJsonRpc } from './json-rpc.ts'
import { type MemberApi, memberApiOf } from './member-api.ts'
import { type ViewContext, taskViewOf } from './task-view.ts'

export interface A2aContext {
  readonly api: Api
  readonly publicUrl: string
  readonly nonce: () => string
}

export const handleA2aMessage = (message: unknown, context: A2aContext): T.Task<unknown> =>
  Array.isArray(message)
    ? T.succeed(BATCH_REFUSED)
    : serveJsonRpc((call) => answer(call, { ...context, api: memberApiOf(context.api) }))(message)

type Operation = 'send' | 'get' | 'cancel' | 'unsupported' | 'push'

const METHODS: Readonly<Record<string, { readonly operation: Operation; readonly dialect: Dialect }>> = {
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

const answer = (call: RpcCall, context: ViewContext): T.Task<unknown, RpcFailure> => {
  const method = Object.hasOwn(METHODS, call.method) ? METHODS[call.method] : undefined
  if (method === undefined) return T.fail(methodNotFound(call.method))
  const { operation, dialect } = method
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
    return T.mapError(rpcFailureOf)(
      T.gen(function* () {
        const draft = yield* draftFromMessage(call.params, context.api)
        return dialect.sendResult(yield* taskViewOf(draft, context))
      }),
    )
  return T.mapError(rpcFailureOf)(
    T.gen(function* () {
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
    }),
  )
}

const taskNote = (id: unknown, api: MemberApi): T.Task<AsRead.Note, RpcFailure | ApiError> => {
  const noteId = NoteId.decode(id)
  const unknownTask = RpcFailure({ code: A2A_CODE.taskNotFound, message: `Task not found: ${String(id)}` })
  return noteId._tag === 'Err'
    ? T.fail(unknownTask)
    : T.mapError(() => unknownTask)(api['notes.get']({ params: { id: noteId.value } }))
}
