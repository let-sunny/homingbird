import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let cy: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
})

afterEach(() => server?.close())

const auditOf = async (...events: string[]) =>
  (await storedRows(server, 'audit_events'))
    .filter((row) => events.includes(String(row.event)))
    .map((row) => [row.event, row.target_id, JSON.parse(String(row.detail))])

describe('the group handlers', () => {
  it('list every group, with the unnamed channel group of one that a new channel gets', async () => {
    const channel = (await ben.api('POST', '/channels', { slug: 'billing', description: 'Invoices' })).json
    const group = {
      id: channel.managedBy,
      kind: 'channel',
      name: null,
      memberIds: [ben.me.member.id],
      channels: ['billing'],
      mayAdd: true,
      mayRemove: true,
      createdAt: expect.any(Number),
    }
    expect((await ben.api('GET', '/groups')).json).toEqual({ groups: [group] })
    expect((await ben.api('GET', `/groups/${channel.managedBy}`)).json).toEqual(group)
    expect((await cy.api('GET', `/groups/${channel.managedBy}`)).json).toMatchObject({
      memberIds: [ben.me.member.id],
      mayAdd: false,
      mayRemove: false,
    })
  })

  it('refuse an identifier that is not a group’s, and answer 404 for a group that does not exist', async () => {
    for (const [method, path, body] of [
      ['GET', '/groups/nobody', undefined],
      ['PATCH', '/groups/nobody', { name: 'Payroll' }],
      ['PUT', '/groups/nobody/members', { memberIds: [] }],
      ['DELETE', '/admin/groups/nobody', undefined],
    ] as const)
      expect([path, (await ana.api(method, path, body)).status]).toEqual([path, 400])
    const missing = 'grp_missing000000'
    for (const [method, path, body] of [
      ['GET', `/groups/${missing}`, undefined],
      ['PATCH', `/groups/${missing}`, { name: 'Payroll' }],
      ['PUT', `/groups/${missing}/members`, { memberIds: [] }],
      ['DELETE', `/admin/groups/${missing}`, undefined],
    ] as const) {
      const answer = await ana.api(method, path, body)
      expect([path, answer.status, answer.json.error.message]).toEqual([path, 404, 'No such group.'])
    }
  })

  it('let an administrator create a group, and audit who it starts with', async () => {
    const created = await ana.api('POST', '/admin/groups', {
      name: 'Finance',
      memberIds: [ben.me.member.id, cy.me.member.id],
    })
    expect(created.json).toMatchObject({
      kind: 'team',
      name: 'Finance',
      channels: [],
      mayAdd: true,
      mayRemove: true,
    })
    expect([...created.json.memberIds].sort()).toEqual([ben.me.member.id, cy.me.member.id].sort())
    const empty = (await ana.api('POST', '/admin/groups', { name: 'Spare' })).json
    expect(empty).toMatchObject({ name: 'Spare', memberIds: [] })
    expect(await auditOf('group.created', 'group.members_changed')).toEqual([
      ['group.members_changed', created.json.id, { added: created.json.memberIds, removed: [] }],
      ['group.created', created.json.id, { memberCount: 2 }],
      ['group.created', empty.id, { memberCount: 0 }],
    ])
    expect((await ben.api('POST', '/admin/groups', { name: 'Mine' })).status).toBe(403)
  })

  it('rename a team, and record the change of its members', async () => {
    const group = (await ana.api('POST', '/admin/groups', { name: 'Finance' })).json
    expect((await ana.api('PATCH', `/groups/${group.id}`, { name: 'Money' })).json.name).toBe('Money')
    expect((await ana.api('PATCH', `/groups/${group.id}`, { name: 'Cash' })).json.name).toBe('Cash')
    await ana.api('PUT', `/groups/${group.id}/members`, { memberIds: [ben.me.member.id] })
    const set = await ana.api('PUT', `/groups/${group.id}/members`, { memberIds: [cy.me.member.id] })
    expect(set.json.memberIds).toEqual([cy.me.member.id])
    expect(await auditOf('group.renamed', 'group.members_changed')).toEqual([
      ['group.renamed', group.id, {}],
      ['group.renamed', group.id, {}],
      ['group.members_changed', group.id, { added: [ben.me.member.id], removed: [] }],
      ['group.members_changed', group.id, { added: [cy.me.member.id], removed: [ben.me.member.id] }],
    ])
  })

  it('delete a team, and refuse a channel’s group', async () => {
    const channel = (await ben.api('POST', '/channels', { slug: 'billing', description: 'Invoices' })).json
    const refused = await ana.api('DELETE', `/admin/groups/${channel.managedBy}`)
    expect([refused.status, refused.json.error.message]).toEqual([
      409,
      'A channel’s managers go only when the channel is archived.',
    ])
    const spare = (await ana.api('POST', '/admin/groups', { name: 'Spare', memberIds: [cy.me.member.id] }))
      .json
    expect((await ana.api('DELETE', `/admin/groups/${spare.id}`)).json).toEqual({})
    expect((await ana.api('GET', `/groups/${spare.id}`)).status).toBe(404)
    expect(await storedRows(server, 'group_members')).toEqual([
      { group_id: channel.managedBy, member_id: ben.me.member.id },
    ])
    expect(await auditOf('group.deleted')).toEqual([['group.deleted', spare.id, {}]])
  })
})
