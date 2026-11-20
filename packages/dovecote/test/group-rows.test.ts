import { Task as T } from '@homingbird/kernel'
import type { GroupId, MemberId } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type ChannelRow, existingChannel } from '../src/domain/channel-rows.ts'
import {
  type GroupChange,
  type GroupRow,
  channelOfGroup,
  existingGroup,
  existingTeam,
  lockGroups,
  requireActiveMembers,
  requireAvailableGroupName,
  requireMayChangeGroup,
} from '../src/domain/group-rows.ts'
import { run } from '../src/sql/database.ts'
import { type Query, insertInto } from '../src/sql/query.ts'
import { type Session, type TestServer, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let cy: Session

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'lobby' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
})

afterEach(() => server.close())

const running = <A>(task: T.Task<A, unknown, any>) => T.runPromise(T.result(task), server.env)

const as = (session: Session) => ({ id: session.me.member.id, role: session.me.member.role })

const channelGroup = async (slug: string, visibility: 'open' | 'private') =>
  (await ben.api('POST', '/channels', { slug, description: 'Money', visibility })).json.managedBy as GroupId

const mayChange = async (session: Session, id: GroupId, change: GroupChange) => {
  const group = (await running(existingGroup(id))) as { value: GroupRow }
  return (await running(requireMayChangeGroup(as(session), group.value, change)))._tag === 'Ok'
}

const everyChange = async (session: Session, id: GroupId) => [
  await mayChange(session, id, 'add'),
  await mayChange(session, id, 'remove'),
]

describe('who may change a group', () => {
  it('lets the managers of an open channel change its group, and nobody else but an administrator', async () => {
    const open = await channelGroup('billing', 'open')
    expect(await everyChange(ben, open)).toEqual([true, true])
    expect(await everyChange(cy, open)).toEqual([false, false])
    expect(await everyChange(ana, open)).toEqual([true, true])
  })

  it('lets an administrator outside a private channel’s group only take people out of it', async () => {
    const closed = await channelGroup('payroll', 'private')
    expect(await everyChange(ben, closed)).toEqual([true, true])
    expect(await everyChange(ana, closed)).toEqual([false, true])
    const group = (await running(existingGroup(closed))) as { value: GroupRow }
    expect(await running(requireMayChangeGroup(as(ana), group.value, 'add'))).toMatchObject({
      _tag: 'Err',
      error: {
        _tag: 'Forbidden',
        message: 'This group manages a private channel: only its members can add people to it.',
      },
    })
    expect(await running(requireMayChangeGroup(as(cy), group.value, 'remove'))).toMatchObject({
      _tag: 'Err',
      error: { message: 'Only the managers of a channel, or an administrator, can change who manages it.' },
    })
  })

  it('lets a member of a private channel’s group add or take out people only while they are in its room', async () => {
    const closed = await channelGroup('payroll', 'private')
    await T.runPromise(
      run(insertInto('group_members', { group_id: closed, member_id: cy.me.member.id })),
      server.env,
    )
    expect(await everyChange(cy, closed)).toEqual([false, false])
    await ben.api('PUT', `/channels/payroll/members/${cy.me.member.id}`)
    expect(await everyChange(cy, closed)).toEqual([true, true])
  })

  it('leaves a team to administrators, even for its own members', async () => {
    const id = (await ana.api('POST', '/admin/groups', { name: 'Finance', memberIds: [ben.me.member.id] }))
      .json.id
    expect(await everyChange(ben, id)).toEqual([false, false])
    expect(await everyChange(ana, id)).toEqual([true, true])
    const group = (await running(existingGroup(id))) as { value: GroupRow }
    expect(await running(requireMayChangeGroup(as(ben), group.value, 'remove'))).toMatchObject({
      error: { message: 'Only an administrator can change a team.' },
    })
  })
})

describe('the kinds of group', () => {
  it('gives every channel its own group, a configured one too, and a team none', async () => {
    const lobby = (await running(existingChannel('lobby'))) as { value: ChannelRow }
    const own = (await running(existingGroup(lobby.value.manager_group_id))) as { value: GroupRow }
    expect(own.value).toMatchObject({ kind: 'channel', name: null, created_by: null })
    expect(await running(channelOfGroup(own.value))).toMatchObject({ value: { slug: 'lobby' } })
    const team = (await ana.api('POST', '/admin/groups', { name: 'Finance' })).json.id
    const row = (await running(existingTeam(team))) as { value: GroupRow }
    expect(await running(channelOfGroup(row.value))).toEqual({ _tag: 'Ok', value: null })
    expect(await running(existingTeam(own.value.id))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'NotFound', message: 'No such group.' },
    })
  })

  it('locks groups in id order, once each, whatever order they are named in', async () => {
    const ids = ['grp_b', 'grp_a', 'grp_b'] as GroupId[]
    const seen: unknown[] = []
    await T.runPromise(
      T.provide({
        connection: {
          ...server.env.connection,
          run: (query: Query) => {
            seen.push(query.params[0])
            return server.env.connection.run(query)
          },
        },
      })(lockGroups(ids)),
      server.env,
    )
    expect(seen).toEqual(['grp_a', 'grp_b'])
  })
})

describe('group names and members', () => {
  it('keeps names unique ignoring case and surrounding space, except for the group itself', async () => {
    const id = (await ana.api('POST', '/admin/groups', { name: 'Finance' })).json.id
    expect(await running(requireAvailableGroupName(' finance ', null))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Conflict', message: 'Another group already has that name.' },
    })
    expect((await running(requireAvailableGroupName('FINANCE', id)))._tag).toBe('Ok')
    expect((await running(requireAvailableGroupName('Payroll', null)))._tag).toBe('Ok')
  })

  it('takes only active members', async () => {
    const ids = [ben.me.member.id, cy.me.member.id]
    expect((await running(requireActiveMembers([])))._tag).toBe('Ok')
    expect((await running(requireActiveMembers([...ids, ids[0]!])))._tag).toBe('Ok')
    await ana.api('PATCH', `/admin/members/${cy.me.member.id}`, { status: 'deactivated' })
    expect(await running(requireActiveMembers(ids))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'NotFound', message: 'No such member.' },
    })
    expect((await running(requireActiveMembers(['mem_nobody0000' as MemberId])))._tag).toBe('Err')
  })
})
