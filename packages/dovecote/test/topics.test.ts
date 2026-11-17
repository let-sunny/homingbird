import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

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

describe('topics', () => {
  it('starts with the seeded topics, and everyone helps in general', async () => {
    expect(
      (await topics(ana)).map((topic) => [topic.slug, topic.description, topic.helperCount, topic.helping]),
    ).toEqual([
      ['billing', 'Invoices and payments', 0, false],
      ['general', 'Anything that has no better place. Everyone is here.', 3, true],
    ])
    expect((await topics(anaAgent, '?q=invoice')).map((topic) => topic.slug)).toEqual(['billing'])
  })

  it('lets any person create a topic and become its first helper', async () => {
    const created = await ana.api('POST', '/topics', { slug: 'deploys', description: 'Release process' })
    expect(created.json).toMatchObject({ slug: 'deploys', helperCount: 1, helping: true })
    expect((await ana.api('POST', '/topics', { slug: 'deploys', description: 'again' })).status).toBe(409)
    expect((await ana.api('POST', '/topics', { slug: 'Not A Slug', description: 'x' })).status).toBe(400)
    expect((await anaAgent.api('POST', '/topics', { slug: 'by-agent', description: 'x' })).status).toBe(403)
    const room = (await ana.api('GET', `/conversations/${created.json.conversationId}`)).json
    expect(room).toMatchObject({ kind: 'topic', title: 'deploys', participantIds: [ana.me.member.id] })
  })

  it('shows on a profile which topics a member helps with, and filters the directory by topic', async () => {
    await ben.api('PUT', '/topics/billing/helpers/me')
    const entries = (await ana.api('GET', '/directory')).json.entries
    expect(Object.fromEntries(entries.map((entry: any) => [entry.member.name, entry.topics]))).toEqual({
      Ana: ['general'],
      Ben: ['billing', 'general'],
      Cy: ['general'],
    })
    const helpers = (await anaAgent.api('GET', '/directory?topic=billing')).json.entries
    expect(helpers.map((entry: any) => entry.member.name)).toEqual(['Ben'])
    await ben.api('DELETE', '/topics/billing/helpers/me')
    expect((await ana.api('GET', '/directory?topic=billing')).json.entries).toEqual([])
    expect((await ben.api('PUT', '/topics/nowhere/helpers/me')).status).toBe(404)
    expect((await benAgent.api('PUT', '/topics/billing/helpers/me')).status).toBe(403)
  })
})

describe('asking a topic', () => {
  beforeEach(async () => {
    await ben.api('PUT', '/topics/billing/helpers/me')
    await cy.api('PUT', '/topics/billing/helpers/me')
  })

  it('delivers the question to every helper and lets the asker follow the room', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { topic: 'billing', body: 'Who owns refunds?' }))
      .json
    expect((await ben.api('GET', `/notes/${draft.id}`)).status).toBe(404)
    const note = (await ana.api('POST', `/drafts/${draft.id}/send`, {})).json
    expect(note.receipts.map((receipt: any) => receipt.memberId).sort()).toEqual(
      [ben.me.member.id, cy.me.member.id].sort(),
    )
    expect(await inboxOf(benAgent)).toEqual(['Who owns refunds?'])
    expect(await inboxOf(cyAgent)).toEqual(['Who owns refunds?'])
    expect((await ana.api('GET', `/conversations/${note.conversationId}`)).json.kind).toBe('topic')
    expect((await topics(ana)).find((topic) => topic.slug === 'billing')).toMatchObject({
      helping: false,
      helperCount: 2,
    })
  })

  it('answers the asker only, and takes the question off the other helpers’ plates', async () => {
    const question = await ask(ana, 'billing', 'Who owns refunds?')
    const draft = (await benAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Ben does.' })).json
    expect(await inboxOf(cyAgent)).toEqual(['Who owns refunds?'])
    const answer = (await ben.api('POST', `/drafts/${draft.id}/send`, {})).json
    expect(answer.receipts.map((receipt: any) => receipt.memberId)).toEqual([ana.me.member.id])
    expect(await inboxOf(cyAgent)).toEqual([])
    expect(await inboxOf(benAgent)).toEqual([])
    const seenByCy = (await cy.api('GET', `/notes/${question.id}`)).json
    expect(seenByCy.receipts.find((receipt: any) => receipt.memberId === ben.me.member.id).state).toBe(
      'replied',
    )
    expect(
      (await cy.api('GET', `/conversations/${question.conversationId}/notes`)).json.notes.map(
        (note: any) => note.body,
      ),
    ).toEqual(['Who owns refunds?', 'Ben does.'])
  })

  it('keeps a topic room closed to members who never joined or asked', async () => {
    const outsider = await server.signIn('dee@example.com', 'Dee')
    const question = await ask(ana, 'billing', 'Who owns refunds?')
    expect((await outsider.api('GET', `/notes/${question.id}`)).status).toBe(404)
    expect((await outsider.api('GET', `/conversations/${question.conversationId}/notes`)).status).toBe(404)
    expect((await outsider.api('GET', '/search?q=refunds')).json.notes).toEqual([])
  })

  it('refuses a topic that does not exist and sends general to everyone', async () => {
    expect((await ana.api('POST', '/drafts', { topic: 'nowhere', body: 'hello?' })).status).toBe(404)
    const note = await ask(ana, 'general', 'Anyone know the wifi password?')
    expect(note.receipts).toHaveLength(2)
  })

  it('accepts a draft request addressed to a topic', async () => {
    const request = (
      await ana.api('POST', '/draft-requests', { topic: 'billing', instruction: 'Ask about refunds' })
    ).json
    const draft = (
      await anaAgent.api('POST', '/drafts', { requestId: request.id, body: 'Who owns refunds?' })
    ).json
    expect(draft.conversationId).toBe(request.conversationId)
  })
})

describe('tidying topics', () => {
  it('is reserved for administrators', async () => {
    expect((await ben.api('PATCH', '/admin/topics/billing', { description: 'mine now' })).status).toBe(403)
    expect((await ben.api('DELETE', '/admin/topics/billing')).status).toBe(403)
    expect((await ben.api('POST', '/admin/topics/billing/merge', { into: 'general' })).status).toBe(403)
  })

  it('renames a topic together with its room', async () => {
    const renamed = (
      await ana.api('PATCH', '/admin/topics/billing', { slug: 'payments', description: 'Money in and out' })
    ).json
    expect(renamed).toMatchObject({ slug: 'payments', description: 'Money in and out' })
    await ben.api('PUT', '/topics/payments/helpers/me')
    expect((await ben.api('GET', `/conversations/${renamed.conversationId}`)).json.title).toBe('payments')
    expect((await ana.api('PATCH', '/admin/topics/payments', { slug: 'general' })).status).toBe(409)
    expect((await ana.api('PATCH', '/admin/topics/general', { slug: 'lobby' })).status).toBe(409)
    expect(
      (await ana.api('PATCH', '/admin/topics/general', { description: 'Start here' })).json.description,
    ).toBe('Start here')
    expect((await ana.api('PATCH', '/admin/topics/nowhere', { description: 'x' })).status).toBe(404)
  })

  it('merges one topic into another, keeping the helpers and the old room’s notes', async () => {
    await ana.api('POST', '/topics', { slug: 'invoices', description: 'Duplicate of billing' })
    await ben.api('PUT', '/topics/invoices/helpers/me')
    const old = await ask(cy, 'invoices', 'Old question')
    const merged = (await ana.api('POST', '/admin/topics/invoices/merge', { into: 'billing' })).json
    expect(merged).toMatchObject({ slug: 'billing', helperCount: 2, helping: true })
    expect((await topics(ana)).map((topic) => topic.slug)).toEqual(['billing', 'general'])
    expect((await ben.api('GET', `/conversations/${old.conversationId}`)).json).toMatchObject({
      kind: 'group',
      title: 'invoices',
    })
    expect((await ana.api('POST', '/admin/topics/billing/merge', { into: 'billing' })).status).toBe(409)
    expect((await ana.api('POST', '/admin/topics/general/merge', { into: 'billing' })).status).toBe(409)
  })

  it('removes a topic but never the general one', async () => {
    expect((await ana.api('DELETE', '/admin/topics/billing')).status).toBe(200)
    expect((await ana.api('DELETE', '/admin/topics/billing')).status).toBe(404)
    expect((await ana.api('DELETE', '/admin/topics/general')).status).toBe(409)
  })
})

describe('moving a question to a better topic', () => {
  beforeEach(async () => {
    await ben.api('PUT', '/topics/billing/helpers/me')
  })

  it('takes it from the helpers of the old topic and gives it to the helpers of the new one', async () => {
    const question = await ask(ana, 'general', 'Who owns refunds?')
    expect(await inboxOf(cyAgent)).toEqual(['Who owns refunds?'])
    const reply = (await cyAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Not me, but…' }))
      .json
    const cursor = (await cy.api('GET', '/events/poll')).json.cursor
    const moved = (await cy.api('POST', `/notes/${question.id}/move`, { topic: 'billing' })).json
    const billing = (await topics(ana)).find((topic) => topic.slug === 'billing')
    expect(moved.conversationId).toBe(billing.conversationId)
    expect(moved.receipts.map((receipt: any) => receipt.memberId)).toEqual([ben.me.member.id])
    expect(await inboxOf(cyAgent)).toEqual([])
    expect(await inboxOf(benAgent)).toEqual(['Who owns refunds?'])
    expect(
      (await cy.api('GET', `/events/poll?after=${cursor}`)).json.events.map((event: any) => event.body),
    ).toEqual([
      {
        type: 'note.moved',
        noteId: question.id,
        fromConversationId: question.conversationId,
        toConversationId: billing.conversationId,
      },
    ])
    expect((await cy.api('GET', `/notes/${question.id}`)).status).toBe(404)
    expect((await ana.api('GET', `/notes/${question.id}`)).json.conversationId).toBe(billing.conversationId)
    expect((await cy.api('GET', `/notes/${reply.id}`)).status).toBe(404)
    expect((await cy.api('GET', `/conversations/${question.conversationId}/notes`)).json.notes).toEqual([])
  })

  it('moves only an unanswered question, only between topics, and only by a person in the room', async () => {
    const question = await ask(ana, 'general', 'Who owns refunds?')
    const outsider = await server.signIn('dee@example.com', 'Dee')
    await outsider.api('DELETE', '/topics/general/helpers/me')
    expect((await outsider.api('POST', `/notes/${question.id}/move`, { topic: 'billing' })).status).toBe(404)
    expect((await cyAgent.api('POST', `/notes/${question.id}/move`, { topic: 'billing' })).status).toBe(403)
    expect((await cy.api('POST', `/notes/${question.id}/move`, { topic: 'general' })).status).toBe(409)
    expect((await cy.api('POST', `/notes/${question.id}/move`, { topic: 'nowhere' })).status).toBe(404)
    const answer = (await cy.api('POST', '/drafts', { inReplyTo: question.id, body: 'Ben does.' })).json
    await cy.api('POST', `/drafts/${answer.id}/send`, {})
    expect((await cy.api('POST', `/notes/${question.id}/move`, { topic: 'billing' })).status).toBe(409)
    expect((await ana.api('POST', `/notes/${answer.id}/move`, { topic: 'billing' })).status).toBe(409)
    const direct = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'direct' })).json
    await ana.api('POST', `/drafts/${direct.id}/send`, {})
    expect((await ben.api('POST', `/notes/${direct.id}/move`, { topic: 'billing' })).status).toBe(409)
  })
})

describe('seed topics', () => {
  const topicsFor = (value?: string) => {
    const config = loadConfig({
      HB_PUBLIC_URL: 'http://localhost:8080',
      HB_DEV_LOGIN: '1',
      ...(value !== undefined && { HB_TOPICS: value }),
    })
    return config._tag === 'Ok'
      ? config.value.topics.map((topic) => `${topic.slug}=${topic.description}`)
      : config.error
  }

  it('always include general, and read slug:description pairs', () => {
    expect(topicsFor()).toEqual(['general=Anything that has no better place. Everyone is here.'])
    expect(topicsFor('billing: Invoices: and payments, infra')).toEqual([
      'general=Anything that has no better place. Everyone is here.',
      'billing=Invoices: and payments',
      'infra=infra',
    ])
    expect(topicsFor('general: Start here')).toEqual(['general=Start here'])
  })

  it('refuse a name that could not be a topic', () => {
    expect(topicsFor('Not A Slug')).toEqual([expect.stringContaining('HB_TOPICS')])
  })
})
