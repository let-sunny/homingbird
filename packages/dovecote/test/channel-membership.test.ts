import { Task as T } from '@homingbird/kernel'
import { GROUP_MEMBERS_MAX } from '@homingbird/protocol'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { run } from '../src/sql/database.ts'
import { insertInto, sql } from '../src/sql/query.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  connectAgent,
  meanwhile,
  startTestServer,
  storedRows,
} from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let cy: Session
let anaAgent: Agent
let benAgent: Agent
let cyAgent: Agent

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'billing: Invoices and payments, lobby: Anything else' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
  for (const person of [ana, ben, cy])
    await person.api('PUT', '/channels/lobby/membership', { answering: true })
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
  cyAgent = await connectAgent(server, cy, { name: 'Cy agent' })
})

afterEach(() => server.close())

const channels = async (who: Session | Agent, query = '') =>
  (await who.api('GET', `/channels${query}`)).json.channels as any[]

const ask = async (author: Session, channel: string, body: string) => {
  const draft = (await author.api('POST', '/drafts', { channel, body })).json
  return (await author.api('POST', `/drafts/${draft.id}/send`, {})).json
}

const inboxOf = async (agent: Agent) =>
  (await agent.api('GET', '/inbox')).json.items.map((item: any) => item.note.body)

describe('private channels', () => {
  const PRIVATE = { slug: 'payroll', description: 'Salaries', visibility: 'private' }

  const create = async (creator: Session = ben) => (await creator.api('POST', '/channels', PRIVATE)).json

  const add = (manager: Session, member: Session) =>
    manager.api('PUT', `/channels/payroll/members/${member.me.member.id}`)

  it('lets any person create one, and makes them its first manager', async () => {
    expect(await create()).toMatchObject({
      slug: 'payroll',
      visibility: 'private',
      memberCount: 1,
      joined: true,
      answering: true,
      managing: true,
    })
    expect((await channels(cy)).map((channel) => channel.slug)).toEqual(['lobby', 'billing'])
  })

  it('answers that a name taken by a hidden private channel is not available, as for any taken name', async () => {
    await create()
    const hidden = await cy.api('POST', '/channels', { slug: 'payroll', description: 'Mine' })
    const visible = await cy.api('POST', '/channels', { slug: 'billing', description: 'Mine' })
    expect([hidden.status, hidden.json]).toEqual([visible.status, visible.json])
    expect(hidden.json.error.message).toBe('That name is not available.')
  })

  it('lets nobody join by themselves, not even someone who can see it', async () => {
    await create()
    expect((await cy.api('PUT', '/channels/payroll/membership', {})).status).toBe(404)
    const admin = await ana.api('PUT', '/channels/payroll/membership', {})
    expect([admin.status, admin.json.error.message]).toEqual([
      403,
      'Only a manager of this private channel can add members.',
    ])
  })

  it('lets a manager add and remove members, and nobody else', async () => {
    await create()
    expect((await add(ben, cy)).json).toMatchObject({ memberCount: 2 })
    expect((await cy.api('GET', '/channels/payroll')).json).toMatchObject({
      joined: true,
      answering: false,
      managing: false,
    })
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect((await add(cy, dee)).status).toBe(403)
    expect((await benAgent.api('PUT', `/channels/payroll/members/${dee.me.member.id}`)).status).toBe(403)
    expect((await dee.api('PUT', `/channels/payroll/members/${dee.me.member.id}`)).status).toBe(404)
    expect((await ben.api('PUT', '/channels/payroll/members/mem_nobody000000')).status).toBe(404)
    expect((await ben.api('DELETE', `/channels/payroll/members/${cy.me.member.id}`)).json.memberCount).toBe(1)
    expect((await cy.api('GET', '/channels/payroll')).status).toBe(404)
    expect((await ben.api('PUT', `/channels/billing/members/${cy.me.member.id}`)).status).toBe(403)
    expect((await ana.api('PUT', `/channels/billing/members/${cy.me.member.id}`)).json.error.message).toBe(
      'People join an open channel by themselves.',
    )
  })

  it('lists its members, with who answers and who manages, to its members only', async () => {
    await create()
    await add(ben, cy)
    const members = (await cy.api('GET', '/channels/payroll/members')).json.members
    expect(members).toEqual(
      expect.arrayContaining([
        { memberId: ben.me.member.id, answering: true, manager: true },
        { memberId: cy.me.member.id, answering: false, manager: false },
      ]),
    )
    expect(members).toHaveLength(2)
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect((await dee.api('GET', '/channels/payroll/members')).status).toBe(404)
    expect((await dee.api('GET', '/channels/billing/members')).status).toBe(403)
  })

  it('discards a removed member’s waiting drafts there and drops the room for them at once', async () => {
    await create()
    await add(ben, cy)
    const question = await ask(ben, 'payroll', 'Who signs off bonuses?')
    const cyAgentDraft = (await cyAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Me' })).json
    const elsewhere = (await cyAgent.api('POST', '/drafts', { channel: 'billing', body: 'Kept' })).json
    const cursor = (await cy.api('GET', '/events/poll')).json.cursor
    await ben.api('DELETE', `/channels/payroll/members/${cy.me.member.id}`)
    expect(
      (await cy.api('GET', `/events/poll?after=${cursor}`)).json.events.map((event: any) => event.body),
    ).toEqual([
      { type: 'draft.discarded', noteId: cyAgentDraft.id, conversationId: question.conversationId },
      { type: 'channel.left', slug: 'payroll', conversationId: question.conversationId },
    ])
    expect((await cy.api('GET', '/drafts')).json.drafts.map((draft: any) => draft.id)).toEqual([elsewhere.id])
    expect((await cy.api('POST', `/drafts/${cyAgentDraft.id}/send`, {})).status).toBe(409)
    expect(
      (await cy.api('GET', '/conversations')).json.conversations.map((room: any) => room.title),
    ).not.toContain('payroll')
  })

  it('keeps its last manager: they cannot leave while others stay, nor be removed', async () => {
    await create()
    await add(ben, cy)
    const leaving = await ben.api('DELETE', '/channels/payroll/membership')
    expect([leaving.status, leaving.json.error.message]).toEqual([
      409,
      'Make another member a manager first: a channel with members keeps a manager.',
    ])
    expect((await ana.api('DELETE', `/channels/payroll/members/${ben.me.member.id}`)).status).toBe(409)
    await cy.api('DELETE', '/channels/payroll/membership')
    expect((await ben.api('DELETE', '/channels/payroll/membership')).json.joined).toBe(false)
  })

  it('takes the last member an administrator removes out of its group too, and no one else', async () => {
    const managing = (await create()).managedBy
    await T.runPromise(
      run(insertInto('group_members', { group_id: managing, member_id: cy.me.member.id })),
      server.env,
    )
    expect((await ana.api('DELETE', `/channels/payroll/members/${ben.me.member.id}`)).status).toBe(200)
    expect((await storedRows(server, 'group_members')).filter((row) => row.group_id === managing)).toEqual([
      { group_id: managing, member_id: cy.me.member.id },
    ])
  })

  it('lets an administrator manage an open channel, and only see who is in a private one', async () => {
    await create()
    expect((await channels(ana)).find((channel) => channel.slug === 'payroll')).toMatchObject({
      joined: false,
      managing: false,
    })
    expect((await ana.api('GET', '/channels/billing')).json.managing).toBe(true)
    expect((await ana.api('PUT', `/channels/payroll/members/${cy.me.member.id}`)).status).toBe(403)
    expect((await ana.api('PUT', `/channels/payroll/members/${ana.me.member.id}`)).status).toBe(403)
    await add(ben, cy)
    expect((await ana.api('PUT', '/channels/payroll/visibility', { visibility: 'open' })).status).toBe(403)
    expect((await ana.api('GET', '/channels/payroll/members')).json.members).toHaveLength(2)
    expect((await ana.api('DELETE', `/channels/payroll/members/${cy.me.member.id}`)).status).toBe(200)
    expect(
      (await ana.api('GET', '/conversations')).json.conversations.map((room: any) => room.title),
    ).not.toContain('payroll')
  })

  it('keeps everyone in the room when an open channel becomes private, and opens again only by a manager', async () => {
    const deploys = (await ben.api('POST', '/channels', { slug: 'deploys', description: 'Releases' })).json
    await cy.api('PUT', '/channels/deploys/membership', {})
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect((await cy.api('PUT', '/channels/deploys/visibility', { visibility: 'private' })).status).toBe(403)
    const cursor = (await cy.api('GET', '/events/poll')).json.cursor
    const closed = (await ben.api('PUT', '/channels/deploys/visibility', { visibility: 'private' })).json
    expect(closed).toMatchObject({ visibility: 'private', memberCount: 2 })
    const told = (await cy.api('GET', `/events/poll?after=${cursor}`)).json.events.map(
      (event: any) => event.body,
    )
    expect(told).toMatchObject([
      { type: 'channel.changed', channel: { slug: 'deploys', visibility: 'private' } },
    ])
    expect((await cy.api('GET', `/conversations/${deploys.conversationId}`)).status).toBe(200)
    expect((await channels(dee)).map((channel) => channel.slug)).not.toContain('deploys')
    expect((await cy.api('PUT', '/channels/deploys/visibility', { visibility: 'open' })).status).toBe(403)
    expect(
      (await ben.api('PUT', '/channels/deploys/visibility', { visibility: 'open' })).json.visibility,
    ).toBe('open')
    expect((await channels(dee)).map((channel) => channel.slug)).toContain('deploys')
    const audited = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'channel.visibility_changed',
    )
    expect(audited.map((row) => [row.actor_id, row.target_id, JSON.parse(String(row.detail))])).toEqual([
      [ben.me.member.id, 'deploys', { visibility: 'private' }],
      [ben.me.member.id, 'deploys', { visibility: 'open' }],
    ])
  })

  it('needs a manager in the room before a channel goes private', async () => {
    const seeded = await ana.api('PUT', '/channels/billing/visibility', { visibility: 'private' })
    expect([seeded.status, seeded.json.error.message]).toEqual([
      409,
      'Make a member of this channel its manager before making it private.',
    ])
    await ben.api('POST', '/channels', { slug: 'deploys', description: 'Releases' })
    expect((await ana.api('PUT', '/channels/deploys/visibility', { visibility: 'private' })).status).toBe(200)
  })

  it('delivers its questions to its answering members only, and lets only members and their agents draft there', async () => {
    await create()
    await add(ben, cy)
    await cy.api('PUT', '/channels/payroll/answering')
    const draft = (await cyAgent.api('POST', '/drafts', { channel: 'payroll', body: 'Bonus dates?' })).json
    const question = (await cy.api('POST', `/drafts/${draft.id}/send`, {})).json
    expect(question.receipts.map((receipt: any) => receipt.memberId)).toEqual([ben.me.member.id])
    expect(await inboxOf(benAgent)).toEqual(['Bonus dates?'])
    expect((await anaAgent.api('POST', '/drafts', { channel: 'payroll', body: 'Me too' })).status).toBe(404)
    expect((await anaAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Me too' })).status).toBe(
      404,
    )
  })

  it('always keeps a manager while it has members, whatever happens to its membership', async () => {
    const dee = await server.signIn('dee@example.com', 'Dee')
    const people = [ben, cy, dee]
    let round = 0
    const operation = fc.record({
      actor: fc.integer({ min: 0, max: 2 }),
      target: fc.integer({ min: 0, max: 2 }),
      kind: fc.constantFrom('add', 'remove', 'leave', 'join'),
    })
    await fc.assert(
      fc.asyncProperty(fc.array(operation, { maxLength: 12 }), async (operations) => {
        const slug = `private-${++round}`
        await people[0]!.api('POST', '/channels', { ...PRIVATE, slug })
        for (const { actor, target, kind } of operations) {
          const by = people[actor]!
          const whom = people[target]!.me.member.id
          const [method, path] = {
            add: ['PUT', `/channels/${slug}/members/${whom}`],
            remove: ['DELETE', `/channels/${slug}/members/${whom}`],
            leave: ['DELETE', `/channels/${slug}/membership`],
            join: ['PUT', `/channels/${slug}/membership`],
          }[kind] as [string, string]
          expect([200, 403, 404, 409]).toContain(
            (await by.api(method, path, method === 'PUT' ? {} : undefined)).status,
          )
          const listed = await ana.api('GET', `/channels/${slug}/members`)
          const members: any[] = listed.json.members
          if (members.length > 0) expect(members.some((member) => member.manager)).toBe(true)
        }
      }),
      { numRuns: 25 },
    )
  })
})

describe('moving questions and private channels', () => {
  beforeEach(async () => {
    for (const slug of ['payroll', 'bonuses'])
      await ben.api('POST', '/channels', { slug, description: 'Money', visibility: 'private' })
    await ben.api('PUT', `/channels/payroll/members/${cy.me.member.id}`)
  })

  it('refuses to move a question out of a private channel into an open one', async () => {
    const question = await ask(cy, 'payroll', 'Bonus dates?')
    const refused = await ben.api('POST', `/notes/${question.id}/move`, { channel: 'billing' })
    expect([refused.status, refused.json.error.message]).toEqual([
      409,
      'A question in a private channel can move only to another private channel with the same members.',
    ])
    expect((await cy.api('GET', `/notes/${question.id}`)).json.conversationId).toBe(question.conversationId)
  })

  it('refuses to move a question to a private channel whose members differ, and allows it when they match', async () => {
    const question = await ask(cy, 'payroll', 'Bonus dates?')
    expect((await ben.api('POST', `/notes/${question.id}/move`, { channel: 'bonuses' })).status).toBe(409)
    await ben.api('PUT', `/channels/bonuses/members/${cy.me.member.id}`)
    const moved = await ben.api('POST', `/notes/${question.id}/move`, { channel: 'bonuses' })
    expect(moved.status).toBe(200)
    expect((await cy.api('GET', `/notes/${question.id}`)).json.conversationId).toBe(moved.json.conversationId)
  })

  it('moves an open question into a private channel only when the person who asked is a member there', async () => {
    const outsider = await ask(ana, 'lobby', 'Where are the salary bands?')
    const refused = await ben.api('POST', `/notes/${outsider.id}/move`, { channel: 'payroll' })
    expect([refused.status, refused.json.error.message]).toEqual([
      409,
      'The person who asked is not a member of that private channel.',
    ])
    expect((await ana.api('POST', `/notes/${outsider.id}/move`, { channel: 'payroll' })).status).toBe(404)
    const member = await ask(cy, 'lobby', 'Where are the salary bands?')
    expect((await ben.api('POST', `/notes/${member.id}/move`, { channel: 'payroll' })).status).toBe(200)
  })

  it('re-addresses a draft into a private channel only for its members', async () => {
    const own = (await ana.api('POST', '/drafts', { channel: 'lobby', body: 'Salary bands?' })).json
    expect((await ana.api('PATCH', `/drafts/${own.id}`, { channel: 'payroll' })).status).toBe(404)
    const member = (await cyAgent.api('POST', '/drafts', { channel: 'lobby', body: 'Salary bands?' })).json
    expect((await cyAgent.api('PATCH', `/drafts/${member.id}`, { channel: 'payroll' })).status).toBe(200)
  })
})

describe('the managers of a channel', () => {
  const PRIVATE = { slug: 'payroll', description: 'Salaries', visibility: 'private' }
  const GROUP_LOCK = /^UPDATE member_groups SET created_at = created_at/

  const teamOf = async (name: string, ...members: Session[]) =>
    (
      await ana.api('POST', '/admin/groups', {
        name,
        memberIds: members.map((member) => member.me.member.id),
      })
    ).json.id as string

  const addTeam = (by: Session, slug: string, groupId: string) =>
    by.api('PUT', `/channels/${slug}/managers/team`, { groupId })

  const managersOf = async (slug: string) =>
    (await ana.api('GET', `/channels/${slug}/members`)).json.members
      .filter((member: any) => member.manager)
      .map((member: any) => member.memberId)
      .sort()

  it('are a group of the channel’s own, its creator alone at first, shown as a channel group', async () => {
    const made = (await ben.api('POST', '/channels', PRIVATE)).json
    expect(made).toMatchObject({ managing: true, memberCount: 1 })
    expect((await ben.api('GET', `/groups/${made.managedBy}`)).json).toMatchObject({
      kind: 'channel',
      name: null,
      memberIds: [ben.me.member.id],
      channels: ['payroll'],
    })
    expect((await ana.api('GET', '/channels/billing')).json.managedBy).toMatch(/^grp_/)
  })

  it('take in the people of a team once, who join the room, and later changes to the team change nothing', async () => {
    const own = (await ben.api('POST', '/channels', PRIVATE)).json.managedBy
    const finance = await teamOf('Finance', cy, ben)
    const cursor = (await cy.api('GET', '/events/poll')).json.cursor
    const added = await addTeam(ben, 'payroll', finance)
    expect(added.json).toMatchObject({ managedBy: own, memberCount: 2, managing: true })
    expect(await managersOf('payroll')).toEqual([ben.me.member.id, cy.me.member.id].sort())
    const told = (await cy.api('GET', `/events/poll?after=${cursor}`)).json.events.map((e: any) => e.body)
    expect(told).toMatchObject([{ type: 'channel.changed', channel: { slug: 'payroll', managing: true } }])
    await ana.api('PUT', `/groups/${finance}/members`, { memberIds: [] })
    expect(await managersOf('payroll')).toEqual([ben.me.member.id, cy.me.member.id].sort())
    expect((await ana.api('GET', `/groups/${finance}`)).json).toMatchObject({ kind: 'team', channels: [] })
  })

  it('records the team’s people as a change to the channel’s group and as added to the channel', async () => {
    const own = (await ben.api('POST', '/channels', PRIVATE)).json.managedBy
    const finance = await teamOf('Finance', ben, cy)
    await addTeam(ben, 'payroll', finance)
    const rows = await storedRows(server, 'audit_events')
    const facts = (event: string) =>
      rows
        .filter((row) => row.event === event)
        .map((row) => [row.actor_id, row.target_id, JSON.parse(String(row.detail))])
    expect(facts('group.members_changed').at(-1)).toEqual([
      ben.me.member.id,
      own,
      { added: [cy.me.member.id], removed: [] },
    ])
    expect(facts('channel.member_added')).toEqual([
      [ben.me.member.id, 'payroll', { memberId: cy.me.member.id }],
    ])
  })

  it('add a team only as someone who may add people to them, and only a team', async () => {
    const made = (await ben.api('POST', '/channels', PRIVATE)).json
    await ben.api('PUT', `/channels/payroll/members/${cy.me.member.id}`)
    const finance = await teamOf('Finance', cy)
    expect((await addTeam(cy, 'payroll', finance)).status).toBe(403)
    expect((await addTeam(ana, 'payroll', finance)).status).toBe(403)
    const billing = (await ana.api('GET', '/channels/billing')).json.managedBy
    expect((await addTeam(ben, 'payroll', billing)).status).toBe(404)
    expect((await addTeam(ben, 'payroll', made.managedBy)).status).toBe(404)
    expect((await addTeam(ben, 'payroll', 'grp_missing000000')).status).toBe(404)
    expect(await managersOf('payroll')).toEqual([ben.me.member.id])
    expect((await addTeam(ana, 'billing', finance)).json).toMatchObject({ managing: true })
    expect(await managersOf('billing')).toEqual([cy.me.member.id])
  })

  it('refuse a team that would give the channel more managers than a group holds, copying no one', async () => {
    await ben.api('POST', '/channels', PRIVATE)
    const many = Array.from(
      { length: GROUP_MEMBERS_MAX },
      (_, index) => `mem_many${String(index).padStart(8, '0')}`,
    )
    for (const id of many)
      await T.runPromise(
        run(
          insertInto('members', {
            id,
            email: `${id}@example.com`,
            subject: id,
            name: id,
            profile: '',
            role: 'member',
            status: 'active',
            event_seq: 0,
            created_at: 0,
            last_seen_at: null,
          }),
        ),
        server.env,
      )
    const crowd = (await ana.api('POST', '/admin/groups', { name: 'Everyone', memberIds: many })).json.id
    const before = await storedRows(server, 'group_members')
    const refused = await addTeam(ben, 'payroll', crowd)
    expect([refused.status, refused.json.error.message]).toEqual([
      409,
      `Adding this team would give the channel more than ${GROUP_MEMBERS_MAX} managers.`,
    ])
    expect(await storedRows(server, 'group_members')).toEqual(before)
    expect(await managersOf('payroll')).toEqual([ben.me.member.id])
  })

  it('lock the channel’s group and the team in id order before reading who is in them', async () => {
    await ben.api('POST', '/channels', PRIVATE)
    const finance = await teamOf('Finance', cy)
    const { statements, request } = meanwhile(server, GROUP_LOCK, [
      sql`DELETE FROM group_members WHERE group_id = ${finance}`,
    ])
    const added = await request('PUT', '/api/v1/channels/payroll/managers/team', {
      cookie: ben.cookie,
      body: { groupId: finance },
    })
    expect(added.status).toBe(200)
    expect(await managersOf('payroll')).toEqual([ben.me.member.id])
    const locks = statements.filter((text) => GROUP_LOCK.test(text))
    expect(locks.length).toBeGreaterThanOrEqual(2)
    expect(statements.findIndex((text) => GROUP_LOCK.test(text))).toBeLessThan(
      statements.findIndex((text) => /FROM group_members/.test(text)),
    )
  })

  it('stay in the room while anyone else is in it', async () => {
    await ben.api('POST', '/channels', PRIVATE)
    await addTeam(ben, 'payroll', await teamOf('Finance', cy))
    const leaving = await cy.api('DELETE', '/channels/payroll/membership')
    expect([leaving.status, leaving.json.error.message]).toEqual([
      409,
      'Members of the group that manages this channel stay in it: leave that group first, or take them out of it.',
    ])
    expect((await ben.api('DELETE', `/channels/payroll/members/${cy.me.member.id}`)).status).toBe(409)
    const own = (await ana.api('GET', '/channels/payroll')).json.managedBy
    await ana.api('PUT', `/groups/${own}/members`, { memberIds: [ben.me.member.id] })
    expect((await cy.api('DELETE', '/channels/payroll/membership')).json.joined).toBe(false)
  })

  it('lock the channel’s group before a manager leaves, so someone added meanwhile keeps a manager in the room', async () => {
    const room = (await ben.api('POST', '/channels', PRIVATE)).json.conversationId
    const { statements, request } = meanwhile(server, GROUP_LOCK, [
      sql`INSERT INTO participants (conversation_id, member_id) VALUES (${room}, ${cy.me.member.id})`,
    ])
    const leaving = await request('DELETE', '/api/v1/channels/payroll/membership', { cookie: ben.cookie })
    expect(leaving.status).toBe(409)
    expect(statements.findIndex((text) => GROUP_LOCK.test(text))).toBeLessThan(
      statements.findIndex((text) => /SELECT p\.member_id FROM participants/.test(text)),
    )
    expect(await managersOf('payroll')).toEqual([ben.me.member.id])
  })

  it('lock the channel’s group before reading its managers, so someone taken out meanwhile adds no one', async () => {
    const own = (await ben.api('POST', '/channels', PRIVATE)).json.managedBy
    await addTeam(ben, 'payroll', await teamOf('Finance', cy))
    const { statements, request } = meanwhile(server, GROUP_LOCK, [
      sql`DELETE FROM group_members WHERE group_id = ${own} AND member_id = ${cy.me.member.id}`,
    ])
    const added = await request('PUT', `/api/v1/channels/payroll/members/${ana.me.member.id}`, {
      cookie: cy.cookie,
    })
    expect(added.status).toBe(403)
    expect(statements.findIndex((text) => GROUP_LOCK.test(text))).toBeLessThan(
      statements.findIndex((text) => /FROM group_members/.test(text)),
    )
    expect((await ana.api('GET', '/channels/payroll')).json.joined).toBe(false)
  })
})
