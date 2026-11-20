import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/sql/database.ts'
import { insertInto, sql } from '../src/sql/query.ts'
import { type Session, type TestServer, meanwhile, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let cy: Session
let dee: Session
let payroll: string

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
  dee = await server.signIn('dee@example.com', 'Dee')
  payroll = (
    await ben.api('POST', '/channels', { slug: 'payroll', description: 'Salaries', visibility: 'private' })
  ).json.managedBy
})

afterEach(() => server.close())

const setMembers = (by: Session, ...members: Session[]) =>
  by.api('PUT', `/groups/${payroll}/members`, { memberIds: members.map((member) => member.me.member.id) })

const roomOf = async () =>
  (await ben.api('GET', '/channels/payroll/members')).json.members.map(
    (member: { memberId: string; manager: boolean }) => [member.memberId, member.manager],
  )

/** A member of the group who is not in its channel's room, as data from before the room kept them out. */
const putIntoGroupOnly = (group: string, member: Session) =>
  T.runPromise(
    run(insertInto('group_members', { group_id: group, member_id: member.me.member.id })),
    server.env,
  )

const sorted = (pairs: Array<[string, boolean]>) => [...pairs].sort(([a], [b]) => a.localeCompare(b))

describe('setting who is in a group', () => {
  it('puts people added into the room of every channel it manages, as its managers, and keeps people taken out there', async () => {
    const cursor = (await cy.api('GET', '/events/poll')).json.cursor
    expect((await setMembers(ben, ben, cy)).json.memberIds).toEqual([ben.me.member.id, cy.me.member.id])
    expect(await roomOf()).toEqual(
      sorted([
        [ben.me.member.id, true],
        [cy.me.member.id, true],
      ]),
    )
    const told = (await cy.api('GET', `/events/poll?after=${cursor}`)).json.events.map((e: any) => e.body)
    expect(told).toMatchObject([{ type: 'channel.changed', channel: { slug: 'payroll', managing: true } }])
    expect((await setMembers(cy, cy)).status).toBe(200)
    expect(await roomOf()).toEqual(
      sorted([
        [ben.me.member.id, false],
        [cy.me.member.id, true],
      ]),
    )
    expect((await ben.api('GET', '/channels/payroll')).json.managing).toBe(false)
  })

  it('never leaves a channel’s group without anyone in it', async () => {
    const emptied = await setMembers(ben)
    expect([emptied.status, emptied.json.error.message]).toEqual([
      409,
      'A channel keeps a manager: add someone else to its managers first.',
    ])
    expect((await setMembers(ben, cy)).status).toBe(200)
    expect(await roomOf()).toEqual(
      sorted([
        [ben.me.member.id, false],
        [cy.me.member.id, true],
      ]),
    )
  })

  it('refuses someone who may not change the group, and anyone who is not an active member', async () => {
    expect((await setMembers(ana, ben, ana)).status).toBe(403)
    await ben.api('PUT', `/channels/payroll/members/${cy.me.member.id}`)
    expect((await setMembers(cy, ben, cy)).status).toBe(403)
    expect((await setMembers(cy, ben)).status).toBe(403)
    const unknown = await ben.api('PUT', `/groups/${payroll}/members`, {
      memberIds: [ben.me.member.id, 'mem_missing000000'],
    })
    expect([unknown.status, unknown.json.error.message]).toEqual([404, 'No such member.'])
    expect(await storedRows(server, 'group_members')).toEqual([
      { group_id: payroll, member_id: ben.me.member.id },
    ])
  })

  it('answers a group someone is not shown as not found, whatever they ask to change', async () => {
    await putIntoGroupOnly(payroll, cy)
    for (const response of [
      await setMembers(cy, ben, cy),
      await setMembers(cy, cy),
      await cy.api('PATCH', `/groups/${payroll}`, { name: 'Mine' }),
    ])
      expect([response.status, response.json.error.message]).toEqual([404, 'No such group.'])
    const byMember = (rows: ReadonlyArray<Readonly<Record<string, unknown>>>) =>
      [...rows].sort((left, right) => String(left.member_id).localeCompare(String(right.member_id)))
    expect(byMember(await storedRows(server, 'group_members'))).toEqual(
      byMember([ben, cy].map((member) => ({ group_id: payroll, member_id: member.me.member.id }))),
    )
  })

  it('keeps a manager in the room, even when someone outside it stays in the group', async () => {
    await ben.api('PUT', `/channels/payroll/members/${cy.me.member.id}`)
    await putIntoGroupOnly(payroll, dee)
    for (const by of [ana, ben]) {
      const taken = await setMembers(by, dee)
      expect([taken.status, taken.json.error.message]).toEqual([
        409,
        'A channel keeps a manager: add someone else to its managers first.',
      ])
    }
    expect((await setMembers(ana, ben)).json.memberIds).toEqual([ben.me.member.id])
  })

  it('lets someone outside an open channel’s unmanaged room take another outsider out, but never empty its group', async () => {
    await ben.api('POST', '/channels', { slug: 'ops', description: 'Operations' })
    const ops = (await ben.api('GET', '/channels/ops')).json.managedBy
    await putIntoGroupOnly(ops, dee)
    await ben.api('DELETE', '/channels/ops/membership')
    await cy.api('PUT', '/channels/ops/membership', {})
    await putIntoGroupOnly(ops, ben)
    const outside = (memberIds: Session[]) =>
      ben.api('PUT', `/groups/${ops}/members`, { memberIds: memberIds.map((member) => member.me.member.id) })
    expect((await outside([ben])).json.memberIds).toEqual([ben.me.member.id])
    expect((await outside([])).status).toBe(409)
  })

  it('lets an administrator outside a private channel’s group take people out, and leaves them in the room', async () => {
    await setMembers(ben, ben, dee)
    expect((await setMembers(ana, ben)).json).toMatchObject({ memberIds: [ben.me.member.id], mayAdd: false })
    expect(await roomOf()).toEqual(
      sorted([
        [ben.me.member.id, true],
        [dee.me.member.id, false],
      ]),
    )
  })

  it('changes nothing when the list is the same, and tells everyone a group changed without content', async () => {
    expect((await setMembers(ben, ben)).json.memberIds).toEqual([ben.me.member.id])
    const cursor = (await dee.api('GET', '/events/poll')).json.cursor
    await setMembers(ben, ben, cy)
    expect((await dee.api('GET', `/events/poll?after=${cursor}`)).json.events).toEqual([])
  })
})

describe('renaming a group', () => {
  it('renames a team, refusing a name another group has, and never a channel’s group', async () => {
    const finance = (await ana.api('POST', '/admin/groups', { name: 'Finance' })).json.id
    expect((await ana.api('PATCH', `/groups/${finance}`, { name: 'Money' })).json.name).toBe('Money')
    await ana.api('POST', '/admin/groups', { name: 'Ops' })
    const taken = await ana.api('PATCH', `/groups/${finance}`, { name: 'OPS' })
    expect([taken.status, taken.json.error.message]).toEqual([409, 'Another group already has that name.'])
    const own = await ben.api('PATCH', `/groups/${payroll}`, { name: 'Payroll team' })
    expect([own.status, own.json.error.message]).toEqual([
      409,
      'A channel’s managers are named after the channel.',
    ])
    expect((await ben.api('PATCH', `/groups/${payroll}`, { name: null })).status).toBe(400)
  })

  it('is refused to anyone but an administrator for a team', async () => {
    const finance = (
      await ana.api('POST', '/admin/groups', { name: 'Finance', memberIds: [ben.me.member.id] })
    ).json.id
    expect((await ben.api('PATCH', `/groups/${finance}`, { name: 'Mine' })).status).toBe(403)
    expect((await ben.api('GET', `/groups/${finance}`)).json.name).toBe('Finance')
  })
})

describe('deactivating a member', () => {
  it('takes them out of every group at once, audited, and tells the channel', async () => {
    await setMembers(ben, ben, cy)
    const finance = (
      await ana.api('POST', '/admin/groups', { name: 'Finance', memberIds: [cy.me.member.id] })
    ).json.id
    const cursor = (await ben.api('GET', '/events/poll')).json.cursor
    await ana.api('PATCH', `/admin/members/${cy.me.member.id}`, { status: 'deactivated' })
    expect((await ben.api('GET', `/groups/${payroll}`)).json.memberIds).toEqual([ben.me.member.id])
    expect((await ben.api('GET', `/groups/${finance}`)).json.memberIds).toEqual([])
    expect(
      (await storedRows(server, 'group_members')).filter((row) => row.member_id === cy.me.member.id),
    ).toEqual([])
    const audited = (await storedRows(server, 'audit_events'))
      .filter((row) => row.event === 'group.members_changed' && String(row.detail).includes('deactivated'))
      .map((row) => [row.actor_id, row.target_id, JSON.parse(String(row.detail))])
    expect(audited.map(([, target]) => target).sort()).toEqual([finance, payroll].sort())
    expect(audited[0]).toEqual([
      ana.me.member.id,
      expect.any(String),
      { added: [], removed: [cy.me.member.id], because: 'deactivated' },
    ])
    const told = (await ben.api('GET', `/events/poll?after=${cursor}`)).json.events.map((e: any) => e.body)
    expect(told).toMatchObject([{ type: 'channel.changed', channel: { slug: 'payroll', memberCount: 1 } }])
  })

  it('takes the last manager out too, the one change that leaves a channel without one', async () => {
    await ben.api('PUT', `/channels/payroll/members/${cy.me.member.id}`)
    await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { status: 'deactivated' })
    expect((await ana.api('GET', '/channels/payroll/members')).json.members).toEqual([
      { memberId: cy.me.member.id, answering: false, manager: false },
    ])
    await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { status: 'deactivated' })
    const audited = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'group.members_changed',
    )
    expect(audited).toHaveLength(1)
  })
})

describe('changing a group while others change it', () => {
  const GROUP_LOCK = /^UPDATE member_groups SET created_at = created_at/

  const lockedBefore = (statements: ReadonlyArray<string>, read: RegExp) => {
    const lockAt = statements.findIndex((text) => GROUP_LOCK.test(text))
    return lockAt >= 0 && lockAt < statements.findIndex((text) => read.test(text))
  }

  it('locks the group before reading who is in it, so two removals cannot empty a managing group', async () => {
    await setMembers(ben, ben, cy)
    const { statements, request } = meanwhile(server, GROUP_LOCK, [
      sql`DELETE FROM group_members WHERE group_id = ${payroll} AND member_id = ${cy.me.member.id}`,
    ])
    const response = await request('PUT', `/api/v1/groups/${payroll}/members`, {
      cookie: ben.cookie,
      body: { memberIds: [cy.me.member.id] },
    })
    expect(response.status).toBe(200)
    expect(lockedBefore(statements, /FROM group_members/)).toBe(true)
    expect(await storedRows(server, 'group_members')).toEqual([
      { group_id: payroll, member_id: cy.me.member.id },
    ])
  })

  it('reads its channel after locking it, so an administrator cannot add people to a channel made private meanwhile', async () => {
    await ben.api('POST', '/channels', { slug: 'ops', description: 'Operations' })
    const ops = (await ben.api('GET', '/channels/ops')).json.managedBy
    const { request } = meanwhile(server, GROUP_LOCK, [
      sql`UPDATE channels SET visibility = 'private' WHERE slug = 'ops'`,
    ])
    const joined = await request('PUT', `/api/v1/groups/${ops}/members`, {
      cookie: ana.cookie,
      body: { memberIds: [ben.me.member.id, ana.me.member.id] },
    })
    expect(joined.status).toBe(403)
    expect((await ben.api('GET', `/groups/${ops}`)).json.memberIds).toEqual([ben.me.member.id])
  })

  it('reads a deactivated member’s groups again once they are locked, so a group they joined meanwhile lets them go too', async () => {
    await ana.api('POST', '/admin/groups', { name: 'Finance', memberIds: [cy.me.member.id] })
    const { request } = meanwhile(server, GROUP_LOCK, [
      insertInto('group_members', { group_id: payroll, member_id: cy.me.member.id }),
    ])
    const deactivated = await request('PATCH', `/api/v1/admin/members/${cy.me.member.id}`, {
      cookie: ana.cookie,
      body: { status: 'deactivated' },
    })
    expect(deactivated.status).toBe(200)
    expect(
      (await storedRows(server, 'group_members')).filter((row) => row.member_id === cy.me.member.id),
    ).toEqual([])
  })

  it('locks the people it adds before reading whether they are active, so one deactivated meanwhile is refused', async () => {
    const MEMBER_LOCK = /^UPDATE members SET status = status/
    const { statements, request } = meanwhile(server, MEMBER_LOCK, [
      sql`UPDATE members SET status = 'deactivated' WHERE id = ${cy.me.member.id}`,
    ])
    const added = await request('PUT', `/api/v1/groups/${payroll}/members`, {
      cookie: ben.cookie,
      body: { memberIds: [ben.me.member.id, cy.me.member.id] },
    })
    expect([added.status, added.json.error.message]).toEqual([404, 'No such member.'])
    expect(statements.findIndex((text) => MEMBER_LOCK.test(text))).toBeLessThan(
      statements.findIndex((text) => /^SELECT id FROM members WHERE id IN/.test(text)),
    )
    expect(await storedRows(server, 'group_members')).toEqual([
      { group_id: payroll, member_id: ben.me.member.id },
    ])
  })

  it('records each person it puts into a room as added to that channel, by whoever changed the group', async () => {
    await setMembers(ben, ben, cy, dee)
    const added = (await storedRows(server, 'audit_events'))
      .filter((row) => row.event === 'channel.member_added')
      .map((row) => [row.actor_id, row.target_id, JSON.parse(String(row.detail)).memberId])
    expect(added).toEqual([
      [ben.me.member.id, 'payroll', cy.me.member.id],
      [ben.me.member.id, 'payroll', dee.me.member.id],
    ])
    await setMembers(ben, ben)
    await setMembers(ben, ben, cy)
    expect(
      (await storedRows(server, 'audit_events')).filter((row) => row.event === 'channel.member_added'),
    ).toHaveLength(2)
  })
})
