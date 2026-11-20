import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let root: Session
let ana: Session
let ben: Session

beforeEach(async () => {
  server = await startTestServer()
  root = await server.signIn('root@example.com', 'Root')
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
})

afterEach(() => server.close())

const spansOf = async (groupId: string) =>
  (await storedRows(server, 'group_member_spans'))
    .filter((row) => row.group_id === groupId)
    .map((row) => ({
      member: row.member_id,
      since: Number(row.joined_at),
      until: row.left_at === null ? null : Number(row.left_at),
    }))
    .sort((a, b) => String(a.member).localeCompare(String(b.member)) || a.since - b.since)

const byMember = <T extends { readonly member: unknown; readonly since: number }>(rows: T[]): T[] =>
  rows.sort((a, b) => String(a.member).localeCompare(String(b.member)) || a.since - b.since)

const ids = () => [ana.me.member.id, ben.me.member.id].sort()

describe('group membership spans', () => {
  it('opens a span when a team is made with people and when someone joins, and closes it when they leave', async () => {
    const start = server.clock.now()
    const team = (
      await root.api('POST', '/admin/groups', { name: 'Payments', memberIds: [ana.me.member.id] })
    ).json
    await server.clock.advance(1_000)
    await root.api('PUT', `/groups/${team.id}/members`, { memberIds: ids() })
    await server.clock.advance(1_000)
    await root.api('PUT', `/groups/${team.id}/members`, { memberIds: [ben.me.member.id] })
    expect(await spansOf(team.id)).toEqual(
      byMember([
        { member: ana.me.member.id, since: start, until: start + 2_000 },
        { member: ben.me.member.id, since: start + 1_000, until: null },
      ]),
    )
  })

  it('reopens the same span for someone who leaves and comes back within one instant', async () => {
    const start = server.clock.now()
    const team = (await root.api('POST', '/admin/groups', { name: 'Payments', memberIds: ids() })).json
    await root.api('PUT', `/groups/${team.id}/members`, { memberIds: [ben.me.member.id] })
    await root.api('PUT', `/groups/${team.id}/members`, { memberIds: ids() })
    expect(await spansOf(team.id)).toEqual(
      byMember([
        { member: ana.me.member.id, since: start, until: null },
        { member: ben.me.member.id, since: start, until: null },
      ]),
    )
  })

  it('closes every span when a team is deleted and when a member is deactivated', async () => {
    const start = server.clock.now()
    const kept = (await root.api('POST', '/admin/groups', { name: 'Kept', memberIds: ids() })).json
    const gone = (await root.api('POST', '/admin/groups', { name: 'Gone', memberIds: ids() })).json
    await server.clock.advance(1_000)
    await root.api('DELETE', `/admin/groups/${gone.id}`)
    await server.clock.advance(1_000)
    await root.api('PATCH', `/admin/members/${ben.me.member.id}`, { status: 'deactivated' })
    expect(await spansOf(gone.id)).toEqual(
      byMember([
        { member: ana.me.member.id, since: start, until: start + 1_000 },
        { member: ben.me.member.id, since: start, until: start + 1_000 },
      ]),
    )
    expect(await spansOf(kept.id)).toEqual(
      byMember([
        { member: ana.me.member.id, since: start, until: null },
        { member: ben.me.member.id, since: start, until: start + 2_000 },
      ]),
    )
  })

  it('follows a channel’s managers, the last person leaving the room and archiving the channel', async () => {
    const start = server.clock.now()
    const channel = (await ana.api('POST', '/channels', { slug: 'billing', description: 'Billing' })).json
    await ben.api('PUT', '/channels/billing/membership', {})
    await server.clock.advance(1_000)
    await ana.api('PUT', `/groups/${channel.managedBy}/members`, { memberIds: ids() })
    await server.clock.advance(1_000)
    await root.api('POST', '/admin/channels/billing/archive', {})
    expect(await spansOf(channel.managedBy)).toEqual(
      byMember([
        { member: ana.me.member.id, since: start, until: start + 2_000 },
        { member: ben.me.member.id, since: start + 1_000, until: start + 2_000 },
      ]),
    )
    const lone = (await ana.api('POST', '/channels', { slug: 'solo', description: 'Solo' })).json
    await server.clock.advance(1_000)
    await ana.api('DELETE', '/channels/solo/membership')
    expect(await spansOf(lone.managedBy)).toEqual(
      byMember([{ member: ana.me.member.id, since: start + 2_000, until: start + 3_000 }]),
    )
  })
})
