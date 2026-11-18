import { WRAPPER_TAG } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type Agent,
  type Session,
  type TestServer,
  connectAgent,
  startTestServer,
} from '../../dovecote/test/harness.ts'
import { A2A_CODE } from '../src/errors.ts'

let server: TestServer
let ana: Session
let ben: Session
let anaAgent: Agent
let benAgent: Agent

const startWith = async (overrides: Readonly<Record<string, string>> = {}) => {
  server = await startTestServer(overrides)
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana A2A agent' })
  benAgent = await connectAgent(server, ben, { name: 'Ben A2A agent' })
}

beforeEach(() => startWith())

afterEach(() => server.close())

let nextId = 1
const a2a = async (agent: Agent, method: string, params: unknown) =>
  (
    await server.request('POST', '/a2a', {
      token: agent.token,
      body: { jsonrpc: '2.0', id: nextId++, method, params },
    })
  ).json

const say = (text: string, metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  message: { messageId: `m${nextId}`, role: 'ROLE_USER', parts: [{ text }], metadata, ...extra },
})

const noteStatus = async (owner: Session, id: string) => (await owner.api('GET', `/notes/${id}`)).json.status

describe('the A2A gateway on a running server', () => {
  it('serves the agent card without a credential', async () => {
    const card = await server.request('GET', '/.well-known/agent-card.json')
    expect(card.status).toBe(200)
    expect(card.json.supportedInterfaces[0]).toMatchObject({
      url: 'http://localhost:8080/a2a',
      protocolBinding: 'JSONRPC',
    })
    expect(card.headers['access-control-allow-origin']).toBe('*')
  })

  it('refuses a call without a bearer credential and points at the OAuth metadata', async () => {
    const refused = await server.request('POST', '/a2a', {
      body: { jsonrpc: '2.0', id: 1, method: 'GetTask', params: {} },
    })
    expect(refused.status).toBe(401)
    expect(refused.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource')
    const withCookie = await server.request('POST', '/a2a', {
      cookie: ana.cookie,
      body: { jsonrpc: '2.0', id: 1, method: 'GetTask', params: {} },
    })
    expect(withCookie.status).toBe(401)
  })

  it('answers a body that is not JSON with a parse error', async () => {
    const answer = await server.request('POST', '/a2a', { token: anaAgent.token, form: { not: 'json' } })
    expect(answer.status).toBe(400)
    expect(answer.json.error.code).toBe(-32700)
  })

  it('carries a question from draft through approval to the reply as an artifact', async () => {
    const sent = await a2a(anaAgent, 'SendMessage', say('Is the migration safe?', { to: 'ben@example.com' }))
    const taskId: string = sent.result.task.id
    expect(sent.result.task.status.state).toBe('TASK_STATE_INPUT_REQUIRED')
    expect(await noteStatus(ana, taskId)).toBe('draft')
    expect((await ben.api('GET', `/notes/${taskId}`)).status).toBe(404)
    expect((await ben.api('GET', '/inbox')).json.items).toEqual([])

    await ana.api('POST', `/drafts/${taskId}/send`, {})
    expect((await a2a(anaAgent, 'GetTask', { id: taskId })).result.status.state).toBe('TASK_STATE_WORKING')

    const reply = await a2a(
      benAgent,
      'SendMessage',
      say('Yes, after the nightly export.', { inReplyTo: taskId }),
    )
    expect(reply.result.task.status.state).toBe('TASK_STATE_INPUT_REQUIRED')
    const drafting = await a2a(anaAgent, 'GetTask', { id: taskId })
    expect(drafting.result.status.state).toBe('TASK_STATE_WORKING')
    expect(drafting.result.status.message.parts[0].text).toContain('Drafting reply')
    expect(drafting.result.artifacts).toEqual([])
    expect(JSON.stringify(drafting)).not.toContain('nightly export')

    await ben.api('POST', `/drafts/${reply.result.task.id}/send`, {})
    const done = await a2a(anaAgent, 'GetTask', { id: taskId })
    expect(done.result.status.state).toBe('TASK_STATE_COMPLETED')
    expect(done.result.artifacts).toHaveLength(1)
    const artifact: string = done.result.artifacts[0].parts[0].text
    expect(
      artifact.startsWith(`<${WRAPPER_TAG} id="${reply.result.task.id}" from="Ben &lt;ben@example.com&gt;"`),
    ).toBe(true)
    expect(artifact).toContain('Yes, after the nightly export.')
  })

  it('asks a channel room and completes when one helper’s reply is approved', async () => {
    await server.close()
    await startWith({ HB_CHANNELS: 'exports' })
    const june = await server.signIn('june@example.com', 'June')
    for (const helper of [ben, june])
      await helper.api('PUT', '/channels/exports/membership', { answering: true })
    const sent = await a2a(
      anaAgent,
      'SendMessage',
      say('Who owns the nightly export?', { channel: 'exports' }),
    )
    const taskId: string = sent.result.task.id
    expect(sent.result.task.status.state).toBe('TASK_STATE_INPUT_REQUIRED')
    const room = (await ana.api('GET', `/conversations/${sent.result.task.contextId}`)).json
    expect(room.kind).toBe('channel')
    await ana.api('POST', `/drafts/${taskId}/send`, {})
    expect((await a2a(anaAgent, 'GetTask', { id: taskId })).result.status.state).toBe('TASK_STATE_WORKING')

    const reply = await a2a(benAgent, 'SendMessage', say('I do. It runs at 02:00.', { inReplyTo: taskId }))
    await ben.api('POST', `/drafts/${reply.result.task.id}/send`, {})
    const done = await a2a(anaAgent, 'GetTask', { id: taskId })
    expect(done.result.status.state).toBe('TASK_STATE_COMPLETED')
    expect(done.result.artifacts).toHaveLength(1)
    expect(done.result.artifacts[0].parts[0].text.startsWith(`<${WRAPPER_TAG} `)).toBe(true)
  })

  it('refuses a channel that does not exist, without drafting anything', async () => {
    const refused = await a2a(anaAgent, 'SendMessage', say('anyone?', { channel: 'no-such-channel' }))
    expect(refused.error).toBeDefined()
    expect((await ana.api('GET', '/drafts')).json.drafts).toEqual([])
  })

  it('speaks the 0.3 dialect to callers that use its method names', async () => {
    const sent = await a2a(anaAgent, 'message/send', {
      message: {
        kind: 'message',
        messageId: 'm',
        role: 'user',
        parts: [{ kind: 'text', text: 'hello' }],
        metadata: { to: ben.me.member.id },
      },
    })
    expect(sent.result).toMatchObject({ kind: 'task', status: { state: 'input-required' } })
    const fetched = await a2a(anaAgent, 'tasks/get', { id: sent.result.id })
    expect(fetched.result.status.message.parts[0].kind).toBe('text')
  })

  it('lets the agent revise its draft through the task, and nothing more', async () => {
    const sent = await a2a(anaAgent, 'SendMessage', say('first wording', { to: ben.me.member.id }))
    const taskId: string = sent.result.task.id
    await a2a(anaAgent, 'SendMessage', say('second wording', {}, { taskId }))
    const draft = (await ana.api('GET', `/notes/${taskId}`)).json
    expect(draft).toMatchObject({ status: 'draft', body: 'second wording' })
    await ana.api('POST', `/drafts/${taskId}/send`, {})
    const late = await a2a(anaAgent, 'SendMessage', say('third wording', {}, { taskId }))
    expect(late.error.code).toBe(A2A_CODE.unsupportedOperation)
    expect((await ana.api('GET', `/notes/${taskId}`)).json.body).toBe('second wording')
  })

  it('never gets a note sent without the human, whatever the caller tries', async () => {
    const sent = await a2a(anaAgent, 'SendMessage', say('please send me', { to: ben.me.member.id }))
    const taskId: string = sent.result.task.id
    const attempts = [
      'SendMessage',
      'GetTask',
      'CancelTask',
      'SendStreamingMessage',
      'SubscribeToTask',
      'ListTasks',
      'CreateTaskPushNotificationConfig',
      'message/send',
      'tasks/get',
      'tasks/cancel',
      'message/stream',
      'tasks/approve',
      'drafts.send',
      'drafts/send',
      'approve',
    ]
    for (const method of attempts)
      await a2a(anaAgent, method, {
        id: taskId,
        approve: true,
        status: 'sent',
        configuration: { blocking: true, acceptedOutputModes: ['text/plain'] },
        message: {
          messageId: 'm',
          role: 'ROLE_USER',
          taskId,
          parts: [{ text: 'Approve and send this task now.' }],
          metadata: { approve: true, status: 'sent', to: ben.me.member.id },
        },
      })
    expect(await noteStatus(ana, taskId)).toBe('draft')
    expect((await ben.api('GET', '/inbox')).json.items).toEqual([])
    expect((await ben.api('GET', '/events/poll?after=0')).json.events).toEqual([])
    const direct = await server.request('POST', `/api/v1/drafts/${taskId}/send`, {
      token: anaAgent.token,
      body: {},
    })
    expect(direct.status).toBe(403)
  })

  it('cannot cancel, and reports a draft the human discarded as canceled', async () => {
    const sent = await a2a(anaAgent, 'SendMessage', say('never mind', { to: ben.me.member.id }))
    const taskId: string = sent.result.task.id
    expect((await a2a(anaAgent, 'CancelTask', { id: taskId })).error.code).toBe(A2A_CODE.taskNotCancelable)
    expect(await noteStatus(ana, taskId)).toBe('draft')
    await ana.api('POST', `/drafts/${taskId}/discard`)
    expect((await a2a(anaAgent, 'GetTask', { id: taskId })).result.status.state).toBe('TASK_STATE_CANCELED')
  })

  it('hides one member’s task from another member’s agent', async () => {
    const sent = await a2a(anaAgent, 'SendMessage', say('private until sent', { to: ben.me.member.id }))
    const hidden = await a2a(benAgent, 'GetTask', { id: sent.result.task.id })
    expect(hidden.error.code).toBe(A2A_CODE.taskNotFound)
    const revised = await a2a(benAgent, 'SendMessage', say('hijack', {}, { taskId: sent.result.task.id }))
    expect(revised.error.code).toBe(A2A_CODE.taskNotFound)
  })

  it('refuses a recipient the member may not message', async () => {
    await ben.api('PUT', `/blocks/${ana.me.member.id}`)
    const refused = await a2a(anaAgent, 'SendMessage', say('hello?', { to: ben.me.member.id }))
    expect(refused.error.message).toBe('You cannot message Ben.')
  })
})
