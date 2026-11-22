import { Task as T } from '@homingbird/kernel'
import { Forbidden, NotFound, type RouteName, contract, humanOnlyRoutes } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { A2A_CODE } from '../src/errors.ts'
import { handleA2aMessage } from '../src/gateway.ts'
import { RPC_CODE } from '../src/json-rpc.ts'
import { ANA, BEN, DIRECTORY, type Stubs, fakeApi, noteOf, receiptOf, sequentialNonce } from './support.ts'

const DRAFT = noteOf({ status: 'draft', authorId: ANA.id, sentAt: null, receipts: [] })
const SENT = noteOf({ authorId: ANA.id, receipts: [receiptOf({ memberId: BEN.id })] })

const HAPPY: Stubs = {
  'drafts.create': () => DRAFT,
  'drafts.update': () => DRAFT,
  'notes.get': () => DRAFT,
  'directory.list': () => DIRECTORY,
}

const gateway = (stubs: Stubs = HAPPY) => {
  const fake = fakeApi(stubs)
  const context = { api: fake.api, publicUrl: 'https://hb.example.com', nonce: sequentialNonce() }
  const call = (method: string, params: unknown = {}, version?: string) =>
    T.runPromise(
      handleA2aMessage({ jsonrpc: '2.0', id: 1, method, params }, context, version),
    ) as Promise<any>
  return { call, calls: fake.calls, context }
}

const MESSAGE = {
  message: { messageId: 'm1', role: 'ROLE_USER', parts: [{ text: 'hi' }], metadata: { to: BEN.id } },
}

const CURRENT_METHODS = ['SendMessage', 'GetTask', 'CancelTask'] as const
const LEGACY_METHODS = ['message/send', 'tasks/get', 'tasks/cancel'] as const

describe('handleA2aMessage', () => {
  it('answers SendMessage with a task that waits for the human, in the 1.0 shape', async () => {
    const { call, calls } = gateway()
    const answer = await call('SendMessage', MESSAGE)
    expect(answer).toMatchObject({ jsonrpc: '2.0', id: 1 })
    expect(answer.result.task).toMatchObject({
      id: DRAFT.id,
      contextId: DRAFT.conversationId,
      status: { state: 'TASK_STATE_INPUT_REQUIRED', message: { role: 'ROLE_AGENT' } },
      artifacts: [],
    })
    expect(calls.map((one) => one.name)).toEqual(['drafts.create'])
  })

  it('answers message/send with the bare task in the 0.3 shape', async () => {
    const answer = await gateway().call('message/send', MESSAGE)
    expect(answer.result).toMatchObject({ kind: 'task', id: DRAFT.id, status: { state: 'input-required' } })
  })

  it.each([
    ['GetTask', 'TASK_STATE_WORKING'],
    ['tasks/get', 'working'],
  ])('answers %s with the current state of the note', async (method, state) => {
    const { call, calls } = gateway({ 'notes.get': () => SENT })
    const answer = await call(method, { id: SENT.id })
    expect((answer.result.status ?? answer.result.task.status).state).toBe(state)
    expect(calls).toEqual([{ name: 'notes.get', request: { params: { id: SENT.id } } }])
  })

  it.each(['GetTask', 'tasks/get', 'CancelTask', 'tasks/cancel'])(
    '%s says task not found for an unknown or malformed id',
    async (method) => {
      const { call, calls } = gateway({ 'notes.get': () => NotFound({ message: 'No such note.' }) })
      expect((await call(method, { id: 'task-1' })).error).toMatchObject({
        code: A2A_CODE.taskNotFound,
        message: 'Task not found: task-1',
      })
      expect((await call(method, {})).error.code).toBe(A2A_CODE.taskNotFound)
      expect(calls).toEqual([])
      expect((await call(method, { id: SENT.id })).error.code).toBe(A2A_CODE.taskNotFound)
    },
  )

  it.each(['CancelTask', 'tasks/cancel'])(
    '%s can never cancel: discarding is a person’s decision',
    async (method) => {
      const { call, calls } = gateway()
      const answer = await call(method, { id: DRAFT.id })
      expect(answer.error.code).toBe(A2A_CODE.taskNotCancelable)
      expect(answer.error.message).toMatch(/Only the member's human can discard/)
      expect(calls.map((one) => one.name)).toEqual(['notes.get'])
    },
  )

  it.each([
    'SendStreamingMessage',
    'SubscribeToTask',
    'ListTasks',
    'GetExtendedAgentCard',
    'message/stream',
    'tasks/resubscribe',
  ])('refuses %s as unsupported', async (method) => {
    const { call, calls } = gateway()
    expect((await call(method, MESSAGE)).error).toMatchObject({
      code: A2A_CODE.unsupportedOperation,
      message: `${method} is not supported by this agent.`,
    })
    expect(calls).toEqual([])
  })

  it.each([
    'CreateTaskPushNotificationConfig',
    'GetTaskPushNotificationConfig',
    'ListTaskPushNotificationConfigs',
    'DeleteTaskPushNotificationConfig',
    'tasks/pushNotificationConfig/set',
    'tasks/pushNotificationConfig/get',
    'tasks/pushNotificationConfig/list',
    'tasks/pushNotificationConfig/delete',
  ])('refuses %s because push notifications are not offered', async (method) => {
    expect((await gateway().call(method)).error.code).toBe(A2A_CODE.pushNotificationNotSupported)
  })

  it('answers an unknown method, or one inherited from Object, with method not found', async () => {
    for (const method of ['tasks/approve', 'drafts.send', 'toString', 'constructor', '__proto__'])
      expect((await gateway().call(method)).error.code).toBe(RPC_CODE.methodNotFound)
  })

  it('refuses a batch', async () => {
    const { context, calls } = gateway()
    const answer: any = await T.runPromise(
      handleA2aMessage([{ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: MESSAGE }], context, '1.0'),
    )
    expect(answer).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: RPC_CODE.invalidRequest, message: 'Invalid Request: batches are not supported' },
    })
    expect(calls).toEqual([])
  })

  it('rejects an envelope that is not JSON-RPC 2.0', async () => {
    const { context } = gateway()
    const answer: any = await T.runPromise(handleA2aMessage({ id: 1, method: 'SendMessage' }, context, '1.0'))
    expect(answer.error.code).toBe(RPC_CODE.invalidRequest)
  })

  it('answers nothing to a notification', async () => {
    const { context } = gateway()
    expect(
      await T.runPromise(handleA2aMessage({ jsonrpc: '2.0', method: 'GetTask', params: {} }, context, '1.0')),
    ).toBeNull()
  })

  it('reports a refusal by the server as a JSON-RPC error with its message', async () => {
    const { call } = gateway({ 'drafts.create': () => Forbidden({ message: 'You cannot message Ben.' }) })
    expect((await call('SendMessage', MESSAGE)).error).toEqual({
      code: RPC_CODE.invalidRequest,
      message: 'You cannot message Ben.',
    })
  })

  it('reaches no human-only route, whatever is sent to any method', async () => {
    const { call, calls } = gateway()
    const everything = { id: DRAFT.id, taskId: DRAFT.id, approve: true, status: 'sent', ...MESSAGE }
    for (const method of [...CURRENT_METHODS, ...LEGACY_METHODS, 'drafts.send', 'drafts.discard'])
      await call(method, { ...everything, message: { ...MESSAGE.message, taskId: DRAFT.id } })
    const reached = new Set(calls.map((one) => one.name))
    expect([...reached].filter((name) => humanOnlyRoutes.includes(name as RouteName))).toEqual([])
    expect([...reached].sort()).toEqual(['drafts.update', 'notes.get'])
  })

  it('has no action that joins, leaves or answers a channel, changes its members, managers or visibility, or runs its agent', async () => {
    const { call, calls } = gateway()
    const membership = (Object.keys(contract) as RouteName[]).filter(
      (name) => name.startsWith('channels.') && humanOnlyRoutes.includes(name),
    )
    expect(membership).toHaveLength(22)
    for (const method of [
      ...CURRENT_METHODS,
      ...LEGACY_METHODS,
      'channels.join',
      'channels/join',
      'JoinChannel',
      'channels.members.add',
    ])
      await call(method, {
        ...MESSAGE,
        slug: 'payroll',
        memberId: 'mem_abcdefghijkl',
        visibility: 'open',
        message: { ...MESSAGE.message, metadata: { channel: 'payroll', join: true, answering: true } },
      })
    expect(calls.map((one) => one.name).filter((name) => membership.includes(name as RouteName))).toEqual([])
  })

  it('is not handed the human-only routes at all', async () => {
    const fake = fakeApi(HAPPY)
    const trapped = new Proxy(fake.api, {
      get: (target, name: string) => {
        if (humanOnlyRoutes.includes(name as RouteName)) throw new Error(`the gateway touched ${name}`)
        return target[name as RouteName]
      },
    })
    const context = { api: trapped, publicUrl: 'https://hb.example.com', nonce: sequentialNonce() }
    const answer: any = await T.runPromise(
      handleA2aMessage({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: MESSAGE }, context, '1.0'),
    )
    expect(answer.result.task.id).toBe(DRAFT.id)
  })
})

describe('A2A-Version negotiation', () => {
  const ERROR_INFO = (reason: string) => [
    { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'a2a-protocol.org' },
  ]

  it.each([
    ['1.0', 'SendMessage', 'TASK_STATE_INPUT_REQUIRED'],
    ['1.0.0', 'SendMessage', 'TASK_STATE_INPUT_REQUIRED'],
    ['0.3', 'message/send', 'input-required'],
  ])('answers A2A-Version %s and %s in that version’s shape', async (version, method, state) => {
    const answer = await gateway().call(method, MESSAGE, version)
    expect((answer.result.task ?? answer.result).status.state).toBe(state)
  })

  it.each([
    ['SendMessage', 'TASK_STATE_INPUT_REQUIRED'],
    ['message/send', 'input-required'],
  ])('lets the method naming decide when no version is stated: %s', async (method, state) => {
    const answer = await gateway().call(method, MESSAGE)
    expect((answer.result.task ?? answer.result).status.state).toBe(state)
  })

  it.each(['2.0', '1.1', '0.2', 'latest'])(
    'refuses A2A-Version %s as not supported, before reaching any route',
    async (version) => {
      const { call, calls } = gateway()
      for (const method of ['SendMessage', 'message/send', 'tasks/approve']) {
        const answer = await call(method, MESSAGE, version)
        expect(answer.error).toEqual({
          code: A2A_CODE.versionNotSupported,
          message: 'This A2A-Version is not supported. Send A2A-Version 1.0 or 0.3.',
          data: ERROR_INFO('VERSION_NOT_SUPPORTED'),
        })
      }
      expect(calls).toEqual([])
    },
  )

  it('never repeats the version it was sent in the error', async () => {
    const version = `9.${'9'.repeat(10_000)}`
    const { message } = (await gateway().call('SendMessage', MESSAGE, version)).error
    expect(message).not.toContain('999')
    expect(message.length).toBeLessThan(100)
  })

  it('answers nothing to a notification with an unsupported version', async () => {
    const { context, calls } = gateway()
    expect(
      await T.runPromise(handleA2aMessage({ jsonrpc: '2.0', method: 'GetTask', params: {} }, context, '2.0')),
    ).toBeNull()
    expect(calls).toEqual([])
  })

  it.each([
    ['1.0', 'message/send', 'tasks/get'],
    ['0.3', 'SendMessage', 'GetTask'],
  ])('refuses A2A-Version %s with the other version’s method names', async (version, send, get) => {
    const { call, calls } = gateway()
    const answer = await call(send, MESSAGE, version)
    expect(answer.error.code).toBe(A2A_CODE.versionNotSupported)
    expect(answer.error.message).toBe(
      `${send} is an A2A ${version === '1.0' ? '0.3' : '1.0'} method, but the request names A2A-Version ${version}.`,
    )
    expect((await call(get, { id: SENT.id }, version)).error.code).toBe(A2A_CODE.versionNotSupported)
    expect(calls).toEqual([])
  })

  it('details a mismatch in the shape of the version the request names', async () => {
    const { call } = gateway()
    expect((await call('message/send', MESSAGE, '1.0')).error.data).toEqual(
      ERROR_INFO('VERSION_NOT_SUPPORTED'),
    )
    expect((await call('SendMessage', MESSAGE, '0.3')).error).not.toHaveProperty('data')
  })

  it('answers an unknown method with method not found, without details', async () => {
    const { call } = gateway()
    for (const version of [undefined, '1.0', '0.3'])
      expect((await call('tasks/approve', {}, version)).error).toEqual({
        code: RPC_CODE.methodNotFound,
        message: 'Method not found: tasks/approve',
      })
  })
})

describe('error details', () => {
  it.each([
    ['GetTask', { id: 'task-1' }, 'TASK_NOT_FOUND'],
    ['CancelTask', { id: DRAFT.id }, 'TASK_NOT_CANCELABLE'],
    ['ListTasks', {}, 'UNSUPPORTED_OPERATION'],
    ['CreateTaskPushNotificationConfig', {}, 'PUSH_NOTIFICATION_NOT_SUPPORTED'],
  ])('adds an ErrorInfo to %s’s A2A error in the 1.0 dialect', async (method, params, reason) => {
    const { error } = await gateway().call(method, params, '1.0')
    expect(error.data).toEqual([
      { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'a2a-protocol.org' },
    ])
  })

  it.each([
    ['tasks/get', { id: 'task-1' }],
    ['tasks/cancel', { id: DRAFT.id }],
    ['message/stream', {}],
    ['tasks/pushNotificationConfig/set', {}],
  ])('keeps %s’s error without details in the 0.3 dialect', async (method, params) => {
    expect((await gateway().call(method, params, '0.3')).error).not.toHaveProperty('data')
  })

  it('adds no ErrorInfo to a plain JSON-RPC error from the server', async () => {
    const { call } = gateway({ 'drafts.create': () => Forbidden({ message: 'You cannot message Ben.' }) })
    expect((await call('SendMessage', MESSAGE, '1.0')).error).toEqual({
      code: RPC_CODE.invalidRequest,
      message: 'You cannot message Ben.',
    })
  })
})
