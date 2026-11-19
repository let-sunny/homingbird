import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { invoke, invokeRaw, localApi } from '../src/api/invoke.ts'
import { callerFor } from './caller-support.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  connectAgent,
  startTestServer,
  storedRows,
} from './harness.ts'

let server: TestServer
let ana: Session
let anaAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
})

afterEach(() => server.close())

const outcome = <A>(task: T.Task<A, unknown, TestServer['env']>) => T.runPromise(T.result(task), server.env)

describe('invoking a route', () => {
  it('asks anyone without a credential to sign in, and refuses an agent a person’s route', async () => {
    expect(await outcome(invoke('me.get', { params: {} } as never, null))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Unauthorized' },
    })
    const agent = await callerFor(server, anaAgent.token)
    expect(await outcome(invoke('insights.mine', { params: {} } as never, agent))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Forbidden', message: 'Only a person can do this; agent credentials are refused.' },
    })
  })

  it('tells a member that a route is for administrators, and counts the attempt', async () => {
    const ben = await server.signIn('ben@example.com', 'Ben')
    const member = await callerFor(server, ben.token)
    expect(await outcome(invoke('admin.insights', { params: {} } as never, member))).toMatchObject({
      _tag: 'Err',
      error: { message: 'Only an administrator can do this.' },
    })
  })

  it('answers 404 for a route whose feature is switched off', async () => {
    const settings = (await ana.api('GET', '/admin/settings')).json
    await ana.api('PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, debateRooms: false },
    })
    const person = await callerFor(server, ana.token)
    expect(await outcome(invoke('debates.list', { params: {} } as never, person))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'NotFound' },
    })
  })

  it('decodes a raw request strictly before the handler sees it', async () => {
    const person = await callerFor(server, ana.token)
    expect(
      await outcome(
        invokeRaw('drafts.create', { params: {}, query: {}, body: { to: ['x'], body: 1 } }, person),
      ),
    ).toMatchObject({ _tag: 'Err', error: { _tag: 'Invalid' } })
    expect(
      await outcome(invokeRaw('search.notes', { params: {}, query: {}, body: undefined }, person)),
    ).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Invalid' },
    })
  })

  it('records the audit event of an audited route in the same step, and serves an in-process API', async () => {
    const person = await callerFor(server, ana.token)
    const api = localApi(person, server.env)
    const agents = await T.runPromise(api['credentials.list']({ params: {} } as never))
    const agent = agents.credentials.find((credential: { kind: string }) => credential.kind === 'agent')!
    await T.runPromise(api['credentials.revoke']({ params: { id: agent.id } } as never))
    const events = (await storedRows(server, 'audit_events')).map((row) => row.event)
    expect(events).toContain('credential.revoked')
  })
})
