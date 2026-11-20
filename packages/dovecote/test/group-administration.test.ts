import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
})

afterEach(() => server.close())

const teams = async () => (await storedRows(server, 'member_groups')).filter((row) => row.kind === 'team')

describe('creating a team', () => {
  it('stores its name, its members once each, and who made it', async () => {
    const group = (
      await ana.api('POST', '/admin/groups', {
        name: 'Finance',
        memberIds: [ben.me.member.id, ben.me.member.id],
      })
    ).json
    expect(group.memberIds).toEqual([ben.me.member.id])
    expect(group.kind).toBe('team')
    expect(await teams()).toEqual([
      {
        id: group.id,
        kind: 'team',
        name: 'Finance',
        created_by: ana.me.member.id,
        created_at: group.createdAt,
      },
    ])
  })

  it('refuses a name another group has, ignoring case, and anyone who is not an active member', async () => {
    await ana.api('POST', '/admin/groups', { name: 'Finance' })
    const taken = await ana.api('POST', '/admin/groups', { name: 'finance' })
    expect([taken.status, taken.json.error.message]).toEqual([409, 'Another group already has that name.'])
    const unknown = await ana.api('POST', '/admin/groups', { name: 'Ops', memberIds: ['mem_missing000000'] })
    expect([unknown.status, unknown.json.error.message]).toEqual([404, 'No such member.'])
    expect((await ana.api('POST', '/admin/groups', {})).status).toBe(400)
    expect(await teams()).toHaveLength(1)
  })

  it('refuses a name that is not one printable line', async () => {
    for (const name of ['', ' ', 'two\nlines', 'x'.repeat(81)])
      expect((await ana.api('POST', '/admin/groups', { name })).status).toBe(400)
  })
})

describe('deleting a group', () => {
  it('removes a team and who was in it', async () => {
    const id = (await ana.api('POST', '/admin/groups', { name: 'Finance', memberIds: [ben.me.member.id] }))
      .json.id
    expect((await ana.api('DELETE', `/admin/groups/${id}`)).status).toBe(200)
    expect(await teams()).toEqual([])
    expect((await storedRows(server, 'group_members')).filter((row) => row.group_id === id)).toEqual([])
  })

  it('refuses a channel’s group, which goes when the channel is archived', async () => {
    const id = (await ben.api('POST', '/channels', { slug: 'billing', description: 'Invoices' })).json
      .managedBy
    const refused = await ana.api('DELETE', `/admin/groups/${id}`)
    expect([refused.status, refused.json.error.message]).toEqual([
      409,
      'A channel’s managers go only when the channel is archived.',
    ])
    await ana.api('POST', '/admin/channels/billing/archive', {})
    expect((await storedRows(server, 'member_groups')).filter((row) => row.id === id)).toEqual([])
    expect((await storedRows(server, 'group_members')).filter((row) => row.group_id === id)).toEqual([])
    expect((await ana.api('GET', `/groups/${id}`)).status).toBe(404)
  })
})
