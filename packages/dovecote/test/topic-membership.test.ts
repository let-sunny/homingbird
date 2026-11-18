import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
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
let ben: Session
let cy: Session
let anaAgent: Agent
let benAgent: Agent
let cyAgent: Agent

beforeEach(async () => {
  server = await startTestServer({ HB_TOPICS: 'billing: Invoices and payments' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
  cyAgent = await connectAgent(server, cy, { name: 'Cy agent' })
})

afterEach(() => server.close())

const topics = async (who: Session | Agent, query = '') =>
  (await who.api('GET', `/topics${query}`)).json.topics as any[]

const ask = async (author: Session, topic: string, body: string) => {
  const draft = (await author.api('POST', '/drafts', { topic, body })).json
  return (await author.api('POST', `/drafts/${draft.id}/send`, {})).json
}

const inboxOf = async (agent: Agent) =>
  (await agent.api('GET', '/inbox')).json.items.map((item: any) => item.note.body)

describe('private topics', () => {
  const PRIVATE = { slug: 'payroll', description: 'Salaries', visibility: 'private' }

  const create = async (creator: Session = ben) => (await creator.api('POST', '/topics', PRIVATE)).json

  const add = (manager: Session, member: Session) =>
    manager.api('PUT', `/topics/payroll/members/${member.me.member.id}`)

  it('lets any person create one, and makes them its first manager', async () => {
    expect(await create()).toMatchObject({
      slug: 'payroll',
      visibility: 'private',
      memberCount: 1,
      joined: true,
      answering: true,
      managing: true,
    })
    expect((await topics(cy)).map((topic) => topic.slug)).toEqual(['billing', 'general'])
  })

  it('answers that a name taken by a hidden private topic is not available, as for any taken name', async () => {
    await create()
    const hidden = await cy.api('POST', '/topics', { slug: 'payroll', description: 'Mine' })
    const visible = await cy.api('POST', '/topics', { slug: 'billing', description: 'Mine' })
    expect([hidden.status, hidden.json]).toEqual([visible.status, visible.json])
    expect(hidden.json.error.message).toBe('That name is not available.')
  })

  it('lets nobody join by themselves, not even someone who can see it', async () => {
    await create()
    expect((await cy.api('PUT', '/topics/payroll/membership', {})).status).toBe(404)
    const admin = await ana.api('PUT', '/topics/payroll/membership', {})
    expect([admin.status, admin.json.error.message]).toEqual([
      403,
      'Only a manager of this private topic can add members.',
    ])
  })

  it('lets a manager add and remove members, and nobody else', async () => {
    await create()
    expect((await add(ben, cy)).json).toMatchObject({ memberCount: 2 })
    expect((await cy.api('GET', '/topics/payroll')).json).toMatchObject({
      joined: true,
      answering: false,
      managing: false,
    })
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect((await add(cy, dee)).status).toBe(403)
    expect((await benAgent.api('PUT', `/topics/payroll/members/${dee.me.member.id}`)).status).toBe(403)
    expect((await dee.api('PUT', `/topics/payroll/members/${dee.me.member.id}`)).status).toBe(404)
    expect((await ben.api('PUT', '/topics/payroll/members/mem_nobody000000')).status).toBe(404)
    expect((await ben.api('DELETE', `/topics/payroll/members/${cy.me.member.id}`)).json.memberCount).toBe(1)
    expect((await cy.api('GET', '/topics/payroll')).status).toBe(404)
    expect((await ben.api('PUT', `/topics/billing/members/${cy.me.member.id}`)).status).toBe(403)
    expect((await ana.api('PUT', `/topics/billing/members/${cy.me.member.id}`)).json.error.message).toBe(
      'People join an open topic by themselves.',
    )
  })

  it('lists its members, with who answers and who manages, to its members only', async () => {
    await create()
    await add(ben, cy)
    const members = (await cy.api('GET', '/topics/payroll/members')).json.members
    expect(members).toEqual(
      expect.arrayContaining([
        { memberId: ben.me.member.id, answering: true, manager: true },
        { memberId: cy.me.member.id, answering: false, manager: false },
      ]),
    )
    expect(members).toHaveLength(2)
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect((await dee.api('GET', '/topics/payroll/members')).status).toBe(404)
    expect((await dee.api('GET', '/topics/billing/members')).status).toBe(403)
  })

  it('discards a removed member’s waiting drafts there and drops the room for them at once', async () => {
    await create()
    await add(ben, cy)
    const question = await ask(ben, 'payroll', 'Who signs off bonuses?')
    const cyAgentDraft = (await cyAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Me' })).json
    const elsewhere = (await cyAgent.api('POST', '/drafts', { topic: 'billing', body: 'Kept' })).json
    const cursor = (await cy.api('GET', '/events/poll')).json.cursor
    await ben.api('DELETE', `/topics/payroll/members/${cy.me.member.id}`)
    expect(
      (await cy.api('GET', `/events/poll?after=${cursor}`)).json.events.map((event: any) => event.body),
    ).toEqual([
      { type: 'draft.discarded', noteId: cyAgentDraft.id, conversationId: question.conversationId },
      { type: 'topic.left', slug: 'payroll', conversationId: question.conversationId },
    ])
    expect((await cy.api('GET', '/drafts')).json.drafts.map((draft: any) => draft.id)).toEqual([elsewhere.id])
    expect((await cy.api('POST', `/drafts/${cyAgentDraft.id}/send`, {})).status).toBe(409)
    expect(
      (await cy.api('GET', '/conversations')).json.conversations.map((room: any) => room.title),
    ).not.toContain('payroll')
  })

  it('lets a manager make another member a manager or take that away, but never the last one', async () => {
    await create()
    await add(ben, cy)
    expect((await cy.api('PUT', `/topics/payroll/managers/${cy.me.member.id}`)).status).toBe(403)
    expect((await ben.api('PUT', `/topics/payroll/managers/${cy.me.member.id}`)).status).toBe(200)
    expect((await cy.api('GET', '/topics/payroll')).json.managing).toBe(true)
    expect((await cy.api('DELETE', `/topics/payroll/managers/${ben.me.member.id}`)).status).toBe(200)
    const last = await cy.api('DELETE', `/topics/payroll/managers/${cy.me.member.id}`)
    expect([last.status, last.json.error.message]).toEqual([
      409,
      'Make another member a manager first: a topic with members keeps a manager.',
    ])
    expect((await cy.api('DELETE', '/topics/payroll/membership')).status).toBe(409)
    expect((await ana.api('DELETE', `/topics/payroll/members/${cy.me.member.id}`)).status).toBe(409)
    const dee = await server.signIn('dee@example.com', 'Dee')
    const outsider = await cy.api('PUT', `/topics/payroll/managers/${dee.me.member.id}`)
    expect([outsider.status, outsider.json.error.message]).toEqual([
      409,
      'Only a member of the topic can become its manager.',
    ])
    await ben.api('DELETE', '/topics/payroll/membership')
    expect((await cy.api('DELETE', '/topics/payroll/membership')).json.joined).toBe(false)
  })

  it('lets an administrator manage any topic, and shows them as able to', async () => {
    await create()
    expect((await topics(ana)).find((topic) => topic.slug === 'payroll')).toMatchObject({
      joined: false,
      managing: true,
    })
    expect((await ana.api('GET', '/topics/billing')).json.managing).toBe(true)
    expect((await ana.api('PUT', `/topics/payroll/members/${cy.me.member.id}`)).status).toBe(200)
    expect((await ana.api('PUT', `/topics/payroll/managers/${cy.me.member.id}`)).status).toBe(200)
    expect((await ana.api('GET', '/topics/payroll/members')).json.members).toHaveLength(2)
    expect(
      (await ana.api('GET', '/conversations')).json.conversations.map((room: any) => room.title),
    ).not.toContain('payroll')
  })

  it('keeps everyone in the room when an open topic becomes private, and opens again only by a manager', async () => {
    const deploys = (await ben.api('POST', '/topics', { slug: 'deploys', description: 'Releases' })).json
    await cy.api('PUT', '/topics/deploys/membership', {})
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect((await cy.api('PUT', '/topics/deploys/visibility', { visibility: 'private' })).status).toBe(403)
    const cursor = (await cy.api('GET', '/events/poll')).json.cursor
    const closed = (await ben.api('PUT', '/topics/deploys/visibility', { visibility: 'private' })).json
    expect(closed).toMatchObject({ visibility: 'private', memberCount: 2 })
    const told = (await cy.api('GET', `/events/poll?after=${cursor}`)).json.events.map(
      (event: any) => event.body,
    )
    expect(told).toMatchObject([{ type: 'topic.changed', topic: { slug: 'deploys', visibility: 'private' } }])
    expect((await cy.api('GET', `/conversations/${deploys.conversationId}`)).status).toBe(200)
    expect((await topics(dee)).map((topic) => topic.slug)).not.toContain('deploys')
    expect((await cy.api('PUT', '/topics/deploys/visibility', { visibility: 'open' })).status).toBe(403)
    expect((await ben.api('PUT', '/topics/deploys/visibility', { visibility: 'open' })).json.visibility).toBe(
      'open',
    )
    expect((await topics(dee)).map((topic) => topic.slug)).toContain('deploys')
    const audited = (await storedRows(server, 'audit_log')).filter(
      (row) => row.action === 'topics.visibility.set',
    )
    expect(audited.map((row) => [row.actor_id, row.target, JSON.parse(String(row.detail)).request])).toEqual([
      [ben.me.member.id, 'deploys', { visibility: 'private' }],
      [ben.me.member.id, 'deploys', { visibility: 'open' }],
    ])
  })

  it('never makes general private, and needs a manager in the room before a topic goes private', async () => {
    expect((await ana.api('PUT', '/topics/general/visibility', { visibility: 'private' })).status).toBe(409)
    const seeded = await ana.api('PUT', '/topics/billing/visibility', { visibility: 'private' })
    expect([seeded.status, seeded.json.error.message]).toEqual([
      409,
      'Make a member of this topic its manager before making it private.',
    ])
    await ben.api('PUT', '/topics/billing/membership', {})
    await ana.api('PUT', `/topics/billing/managers/${ben.me.member.id}`)
    expect((await ana.api('PUT', '/topics/billing/visibility', { visibility: 'private' })).status).toBe(200)
  })

  it('delivers its questions to its answering members only, and lets only members and their agents draft there', async () => {
    await create()
    await add(ben, cy)
    await cy.api('PUT', '/topics/payroll/answering')
    const draft = (await cyAgent.api('POST', '/drafts', { topic: 'payroll', body: 'Bonus dates?' })).json
    const question = (await cy.api('POST', `/drafts/${draft.id}/send`, {})).json
    expect(question.receipts.map((receipt: any) => receipt.memberId)).toEqual([ben.me.member.id])
    expect(await inboxOf(benAgent)).toEqual(['Bonus dates?'])
    expect((await anaAgent.api('POST', '/drafts', { topic: 'payroll', body: 'Me too' })).status).toBe(404)
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
      kind: fc.constantFrom('add', 'remove', 'grant', 'revoke', 'leave', 'join'),
    })
    await fc.assert(
      fc.asyncProperty(fc.array(operation, { maxLength: 12 }), async (operations) => {
        const slug = `private-${++round}`
        await people[0]!.api('POST', '/topics', { ...PRIVATE, slug })
        for (const { actor, target, kind } of operations) {
          const by = people[actor]!
          const whom = people[target]!.me.member.id
          const [method, path] = {
            add: ['PUT', `/topics/${slug}/members/${whom}`],
            remove: ['DELETE', `/topics/${slug}/members/${whom}`],
            grant: ['PUT', `/topics/${slug}/managers/${whom}`],
            revoke: ['DELETE', `/topics/${slug}/managers/${whom}`],
            leave: ['DELETE', `/topics/${slug}/membership`],
            join: ['PUT', `/topics/${slug}/membership`],
          }[kind] as [string, string]
          expect([200, 403, 404, 409]).toContain(
            (await by.api(method, path, method === 'PUT' ? {} : undefined)).status,
          )
          const listed = await ana.api('GET', `/topics/${slug}/members`)
          const members: any[] = listed.json.members
          if (members.length > 0) expect(members.some((member) => member.manager)).toBe(true)
        }
      }),
      { numRuns: 25 },
    )
  })
})

describe('moving questions and private topics', () => {
  beforeEach(async () => {
    for (const slug of ['payroll', 'bonuses'])
      await ben.api('POST', '/topics', { slug, description: 'Money', visibility: 'private' })
    await ben.api('PUT', `/topics/payroll/members/${cy.me.member.id}`)
  })

  it('refuses to move a question out of a private topic into an open one', async () => {
    const question = await ask(cy, 'payroll', 'Bonus dates?')
    const refused = await ben.api('POST', `/notes/${question.id}/move`, { topic: 'billing' })
    expect([refused.status, refused.json.error.message]).toEqual([
      409,
      'A question in a private topic can move only to another private topic with the same members.',
    ])
    expect((await cy.api('GET', `/notes/${question.id}`)).json.conversationId).toBe(question.conversationId)
  })

  it('refuses to move a question to a private topic whose members differ, and allows it when they match', async () => {
    const question = await ask(cy, 'payroll', 'Bonus dates?')
    expect((await ben.api('POST', `/notes/${question.id}/move`, { topic: 'bonuses' })).status).toBe(409)
    await ben.api('PUT', `/topics/bonuses/members/${cy.me.member.id}`)
    const moved = await ben.api('POST', `/notes/${question.id}/move`, { topic: 'bonuses' })
    expect(moved.status).toBe(200)
    expect((await cy.api('GET', `/notes/${question.id}`)).json.conversationId).toBe(moved.json.conversationId)
  })

  it('moves an open question into a private topic only when the person who asked is a member there', async () => {
    const outsider = await ask(ana, 'general', 'Where are the salary bands?')
    const refused = await ben.api('POST', `/notes/${outsider.id}/move`, { topic: 'payroll' })
    expect([refused.status, refused.json.error.message]).toEqual([
      409,
      'The person who asked is not a member of that private topic.',
    ])
    expect((await ana.api('POST', `/notes/${outsider.id}/move`, { topic: 'payroll' })).status).toBe(404)
    const member = await ask(cy, 'general', 'Where are the salary bands?')
    expect((await ben.api('POST', `/notes/${member.id}/move`, { topic: 'payroll' })).status).toBe(200)
  })

  it('re-addresses a draft into a private topic only for its members', async () => {
    const own = (await ana.api('POST', '/drafts', { topic: 'general', body: 'Salary bands?' })).json
    expect((await ana.api('PATCH', `/drafts/${own.id}`, { topic: 'payroll' })).status).toBe(404)
    const member = (await cyAgent.api('POST', '/drafts', { topic: 'general', body: 'Salary bands?' })).json
    expect((await cyAgent.api('PATCH', `/drafts/${member.id}`, { topic: 'payroll' })).status).toBe(200)
  })
})
