import { Task as T } from '@homingbird/kernel'
import type { GroupId } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type GroupViewer, groupById, groupViewerOf, listGroups } from '../src/domain/groups.ts'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let cy: Session
let anaAgent: Agent
let payroll: GroupId
let billing: GroupId

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
  payroll = (
    await ben.api('POST', '/channels', { slug: 'payroll', description: 'Salaries', visibility: 'private' })
  ).json.managedBy
  await server.clock.advance(1)
  billing = (await ben.api('POST', '/channels', { slug: 'billing', description: 'Invoices' })).json.managedBy
  await server.clock.advance(1)
})

afterEach(() => server?.close())

const running = <A>(task: T.Task<A, unknown, any>) => T.runPromise(T.result(task), server.env)

const person = (session: Session): GroupViewer => ({
  id: session.me.member.id,
  role: session.me.member.role,
  person: true,
})

describe('groups', () => {
  it('shows a channel’s group only to someone who may see that channel, an administrator’s agent excepted', async () => {
    const team = (await ana.api('POST', '/admin/groups', { name: 'Finance' })).json.id
    const listedFor = async (viewer: GroupViewer) =>
      ((await running(listGroups(viewer))) as { value: { groups: Array<{ id: string }> } }).value.groups.map(
        (group) => group.id,
      )
    expect(await listedFor(person(ben))).toEqual([payroll, billing, team])
    expect(await listedFor(person(ana))).toEqual([payroll, billing, team])
    expect(await listedFor(person(cy))).toEqual([billing, team])
    expect(await listedFor({ ...person(ana), role: 'member' })).toEqual([billing, team])
    expect(await running(groupById(person(cy), payroll))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'NotFound', message: 'No such group.' },
    })
    expect(await running(groupById(person(ana), payroll))).toMatchObject({
      value: { kind: 'channel', channels: ['payroll'] },
    })
    expect(await running(groupById(person(cy), team))).toMatchObject({
      value: { kind: 'team', channels: [] },
    })
  })

  it('reads every group in the order they were made', async () => {
    const later = (await ana.api('POST', '/admin/groups', { name: 'Finance' })).json.id
    const listed = (await running(listGroups(person(ben)))) as { value: { groups: Array<{ id: string }> } }
    expect(listed.value.groups.map((group) => group.id)).toEqual([payroll, billing, later])
  })

  it('names active members only', async () => {
    await running(
      run(sql`INSERT INTO group_members (group_id, member_id) VALUES (${payroll}, ${cy.me.member.id})`),
    )
    await running(run(sql`UPDATE members SET status = 'deactivated' WHERE id = ${cy.me.member.id}`))
    expect(await running(groupById(person(ana), payroll))).toMatchObject({
      _tag: 'Ok',
      value: { memberIds: [ben.me.member.id] },
    })
  })

  it('tells an agent that it may change no group, even when its person may', async () => {
    const agent = { ...person(ben), person: false }
    expect(await running(groupById(agent, payroll))).toMatchObject({
      value: { mayAdd: false, mayRemove: false },
    })
    expect((await anaAgent.api('GET', `/groups/${billing}`)).json).toMatchObject({
      channels: ['billing'],
      mayAdd: false,
      mayRemove: false,
    })
    expect((await anaAgent.api('GET', `/groups/${payroll}`)).status).toBe(404)
  })

  it('reads a caller as a person only through their own sign-in', () => {
    const caller = { member: ana.me.member, credential: { id: 'cred_x', kind: 'agent', name: 'x' } } as any
    expect(groupViewerOf(caller)).toMatchObject({ role: 'member', person: false })
    expect(groupViewerOf({ ...caller, credential: { ...caller.credential, kind: 'human' } })).toMatchObject({
      role: 'admin',
      person: true,
    })
  })
})
