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
  server = await startTestServer({ HB_TOPICS: 'billing: Invoices and payments, lobby: Anything else' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
  for (const person of [ana, ben, cy])
    await person.api('PUT', '/topics/lobby/membership', { answering: true })
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
  it('starts with exactly the seeded topics', async () => {
    expect(
      (await topics(ana)).map((topic) => [topic.slug, topic.description, topic.helperCount, topic.answering]),
    ).toEqual([
      ['lobby', 'Anything else', 3, true],
      ['billing', 'Invoices and payments', 0, false],
    ])
    expect((await topics(anaAgent, '?q=invoice')).map((topic) => topic.slug)).toEqual(['billing'])
  })

  it('lists the topics I am in first, then the fullest, then by name, a page at a time', async () => {
    for (const slug of ['alpha', 'beta', 'gamma'])
      await ana.api('POST', '/topics', { slug, description: `About ${slug}` })
    await ben.api('PUT', '/topics/gamma/membership', {})
    await cy.api('PUT', '/topics/gamma/membership', {})
    await ben.api('PUT', '/topics/billing/membership', {})
    await cy.api('DELETE', '/topics/lobby/membership')
    const page = async (who: Session, query: string) => (await who.api('GET', `/topics${query}`)).json
    expect((await page(ben, '')).topics.map((topic: any) => topic.slug)).toEqual([
      'gamma',
      'lobby',
      'billing',
      'alpha',
      'beta',
    ])
    const first = await page(ben, '?limit=2')
    expect([first.topics.map((topic: any) => topic.slug), first.hasMore, first.cursor]).toEqual([
      ['gamma', 'lobby'],
      true,
      '2',
    ])
    const last = await page(ben, '?limit=2&cursor=4')
    expect([last.topics.map((topic: any) => topic.slug), last.hasMore, last.cursor]).toEqual([
      ['beta'],
      false,
      null,
    ])
    expect((await page(ben, '?q=about')).topics.map((topic: any) => topic.slug)).toEqual([
      'gamma',
      'alpha',
      'beta',
    ])
    expect((await ben.api('GET', '/topics?limit=0')).json.topics).toHaveLength(1)
    expect((await ben.api('GET', '/topics?limit=x')).status).toBe(400)
  })

  it('adds a new member to no topic', async () => {
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect((await topics(dee)).map((topic) => [topic.slug, topic.joined, topic.answering])).toEqual([
      ['lobby', false, false],
      ['billing', false, false],
    ])
    const entries = (await dee.api('GET', '/directory')).json.entries
    expect(entries.find((entry: any) => entry.member.name === 'Dee').topics).toEqual([])
  })

  it('lets any person create a topic and become its first member, manager and helper', async () => {
    const created = await ben.api('POST', '/topics', { slug: 'deploys', description: 'Release process' })
    expect(created.json).toMatchObject({
      slug: 'deploys',
      visibility: 'open',
      memberCount: 1,
      helperCount: 1,
      joined: true,
      answering: true,
      managing: true,
    })
    const again = await ana.api('POST', '/topics', { slug: 'deploys', description: 'again' })
    expect([again.status, again.json.error.message]).toEqual([409, 'That name is not available.'])
    expect((await ana.api('POST', '/topics', { slug: 'Not A Slug', description: 'x' })).status).toBe(400)
    expect((await anaAgent.api('POST', '/topics', { slug: 'by-agent', description: 'x' })).status).toBe(403)
    const room = (await ben.api('GET', `/conversations/${created.json.conversationId}`)).json
    expect(room).toMatchObject({ kind: 'topic', title: 'deploys', participantIds: [ben.me.member.id] })
  })

  it('shows on a profile which topics a member helps with, and filters the directory by topic', async () => {
    await ben.api('PUT', '/topics/billing/membership', { answering: true })
    const entries = (await ana.api('GET', '/directory')).json.entries
    expect(Object.fromEntries(entries.map((entry: any) => [entry.member.name, entry.topics]))).toEqual({
      Ana: ['lobby'],
      Ben: ['billing', 'lobby'],
      Cy: ['lobby'],
    })
    const helpers = (await anaAgent.api('GET', '/directory?topic=billing')).json.entries
    expect(helpers.map((entry: any) => entry.member.name)).toEqual(['Ben'])
    await ben.api('DELETE', '/topics/billing/membership')
    expect((await ana.api('GET', '/directory?topic=billing')).json.entries).toEqual([])
    expect((await ben.api('PUT', '/topics/nowhere/membership', { answering: true })).status).toBe(404)
    expect((await benAgent.api('PUT', '/topics/billing/membership', { answering: true })).status).toBe(403)
  })
})

describe('asking a topic', () => {
  beforeEach(async () => {
    await ben.api('PUT', '/topics/billing/membership', { answering: true })
    await cy.api('PUT', '/topics/billing/membership', { answering: true })
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
      answering: false,
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

  it('refuses a topic that does not exist and reaches everyone who answers in the one named', async () => {
    expect((await ana.api('POST', '/drafts', { topic: 'nowhere', body: 'hello?' })).status).toBe(404)
    const note = await ask(ana, 'lobby', 'Anyone know the wifi password?')
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

describe('moving a question to a better topic', () => {
  beforeEach(async () => {
    await ben.api('PUT', '/topics/billing/membership', { answering: true })
  })

  it('takes it from the helpers of the old topic and gives it to the helpers of the new one', async () => {
    const question = await ask(ana, 'lobby', 'Who owns refunds?')
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
      { type: 'draft.discarded', noteId: reply.id, conversationId: question.conversationId },
      {
        type: 'note.moved',
        noteId: question.id,
        fromConversationId: question.conversationId,
        toConversationId: billing.conversationId,
      },
    ])
    expect((await cy.api('GET', `/notes/${question.id}`)).status).toBe(404)
    expect((await ana.api('GET', `/notes/${question.id}`)).json.conversationId).toBe(billing.conversationId)
    expect((await cy.api('GET', `/notes/${reply.id}`)).json).toMatchObject({
      status: 'discarded',
      conversationId: question.conversationId,
    })
    expect((await cy.api('GET', `/conversations/${question.conversationId}/notes`)).json.notes).toEqual([])
  })

  it('discards the waiting replies of members outside the new room and moves the others with the question', async () => {
    const question = await ask(ana, 'lobby', 'Who owns refunds?')
    const outside = (await cyAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Not me.' })).json
    const inside = (await benAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'I do.' })).json
    const benCursor = (await ben.api('GET', '/events/poll')).json.cursor
    const moved = (await cy.api('POST', `/notes/${question.id}/move`, { topic: 'billing' })).json

    expect((await cy.api('GET', '/drafts')).json.drafts).toEqual([])
    expect((await cy.api('POST', `/drafts/${outside.id}/send`, {})).status).toBe(409)
    const kept = (await ben.api('GET', `/notes/${inside.id}`)).json
    expect(kept).toMatchObject({ status: 'draft', conversationId: moved.conversationId, body: 'I do.' })
    const benEvents = (await ben.api('GET', `/events/poll?after=${benCursor}`)).json.events
    expect(benEvents.map((event: any) => event.body.type)).toEqual(['note.moved', 'note.sent', 'draft.saved'])
    expect(benEvents[2].body.note).toEqual(kept)
    expect(moved.receipts).toMatchObject([{ memberId: ben.me.member.id, state: 'drafting' }])

    const sent = (await ben.api('POST', `/drafts/${inside.id}/send`, {})).json
    expect(sent).toMatchObject({ status: 'sent', conversationId: moved.conversationId })
    expect((await ana.api('GET', `/notes/${sent.id}`)).json.body).toBe('I do.')
  })

  it('moves only an unanswered question, only between topics, and only by a person in the room', async () => {
    const question = await ask(ana, 'lobby', 'Who owns refunds?')
    const outsider = await server.signIn('dee@example.com', 'Dee')
    expect((await outsider.api('POST', `/notes/${question.id}/move`, { topic: 'billing' })).status).toBe(404)
    expect((await cyAgent.api('POST', `/notes/${question.id}/move`, { topic: 'billing' })).status).toBe(403)
    expect((await cy.api('POST', `/notes/${question.id}/move`, { topic: 'lobby' })).status).toBe(409)
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

describe('re-addressing a draft question', () => {
  beforeEach(async () => {
    await ben.api('PUT', '/topics/billing/membership', { answering: true })
  })

  it('moves an agent’s draft to another topic room, keeping its id, origin and agent name', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { topic: 'lobby', body: 'Who owns refunds?' })).json
    const cursor = (await ana.api('GET', '/events/poll')).json.cursor
    const moved = (await ana.api('PATCH', `/drafts/${draft.id}`, { topic: 'billing' })).json
    const billing = (await topics(ana)).find((topic) => topic.slug === 'billing')
    expect(moved).toMatchObject({
      id: draft.id,
      conversationId: billing.conversationId,
      status: 'draft',
      body: 'Who owns refunds?',
      origin: 'agent',
      agentName: 'Ana agent',
    })
    expect((await ana.api('GET', `/conversations/${billing.conversationId}`)).json.participantIds).toContain(
      ana.me.member.id,
    )
    expect(
      (await ana.api('GET', `/events/poll?after=${cursor}`)).json.events.map((event: any) => event.body),
    ).toEqual([{ type: 'draft.saved', note: moved }])
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, {})).json
    expect(sent.receipts.map((receipt: any) => receipt.memberId)).toEqual([ben.me.member.id])
    expect(await inboxOf(cyAgent)).toEqual([])
  })

  it('changes the text and the topic in one step, and marks a person’s change to the text', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { topic: 'lobby', body: 'Refunds?' })).json
    const moved = (
      await ana.api('PATCH', `/drafts/${draft.id}`, { topic: 'billing', body: 'Who owns refunds?' })
    ).json
    expect(moved).toMatchObject({ body: 'Who owns refunds?', origin: 'human_edited', agentName: 'Ana agent' })
  })

  it('lets the drafting agent re-address its own draft, which the person still sees before approving', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { topic: 'lobby', body: 'Who owns refunds?' })).json
    const moved = (await anaAgent.api('PATCH', `/drafts/${draft.id}`, { topic: 'billing' })).json
    expect(moved).toMatchObject({ id: draft.id, status: 'draft', origin: 'agent' })
    expect((await ana.api('GET', '/drafts')).json.drafts.map((each: any) => each.conversationId)).toEqual([
      moved.conversationId,
    ])
  })

  it('keeps a draft request answer linked to its request', async () => {
    const request = (await ana.api('POST', '/draft-requests', { topic: 'lobby', instruction: 'Ask' })).json
    const draft = (
      await anaAgent.api('POST', '/drafts', { requestId: request.id, body: 'Who owns refunds?' })
    ).json
    await ana.api('PATCH', `/drafts/${draft.id}`, { topic: 'billing' })
    const requests = (await ana.api('GET', '/draft-requests')).json.requests
    expect(requests.find((each: any) => each.id === request.id)?.draftIds).toEqual([draft.id])
  })

  it('re-addresses only an unsent question drafted to a topic, and only to a topic that exists', async () => {
    const question = await ask(cy, 'lobby', 'Who owns refunds?')
    const reply = (await ana.api('POST', '/drafts', { inReplyTo: question.id, body: 'Ben does.' })).json
    expect((await ana.api('PATCH', `/drafts/${reply.id}`, { topic: 'billing' })).status).toBe(409)
    const direct = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'direct' })).json
    expect((await ana.api('PATCH', `/drafts/${direct.id}`, { topic: 'billing' })).status).toBe(409)
    const draft = (await ana.api('POST', '/drafts', { topic: 'lobby', body: 'Who owns refunds?' })).json
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, { topic: 'nowhere' })).status).toBe(404)
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, {})).status).toBe(400)
    expect((await ben.api('PATCH', `/drafts/${draft.id}`, { topic: 'billing' })).status).toBe(404)
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, { topic: 'billing' })).status).toBe(409)
    expect((await ana.api('PATCH', `/notes/${question.id}`, { topic: 'billing' })).status).toBe(404)
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

  it('hold exactly the listed topics, read as slug:description pairs', () => {
    expect(topicsFor()).toEqual([])
    expect(topicsFor('billing: Invoices: and payments, infra')).toEqual([
      'billing=Invoices: and payments',
      'infra=infra',
    ])
    expect(topicsFor('general: Start here')).toEqual(['general=Start here'])
  })

  it('refuse a name that could not be a topic', () => {
    expect(topicsFor('Not A Slug')).toEqual([expect.stringContaining('HB_TOPICS')])
  })
})

describe('joining a topic and answering in it', () => {
  const billing = async (who: Session) => (await who.api('GET', '/topics/billing')).json

  it('joins a room without answering, so its questions reach only the people who answer there', async () => {
    const joined = (await ben.api('PUT', '/topics/billing/membership', {})).json
    expect(joined).toMatchObject({ joined: true, answering: false, memberCount: 1, helperCount: 0 })
    await cy.api('PUT', '/topics/billing/membership', { answering: true })
    const question = await ask(ana, 'billing', 'Who owns refunds?')
    expect(question.receipts.map((receipt: any) => receipt.memberId)).toEqual([cy.me.member.id])
    expect(await inboxOf(benAgent)).toEqual([])
    expect(
      (await ben.api('GET', `/conversations/${question.conversationId}/notes`)).json.notes.map(
        (note: any) => note.body,
      ),
    ).toEqual(['Who owns refunds?'])
  })

  it('turns answering on and off without leaving the room, and leaving turns it off', async () => {
    await ben.api('PUT', '/topics/billing/membership', {})
    expect((await ben.api('PUT', '/topics/billing/answering')).json).toMatchObject({ answering: true })
    expect((await ben.api('DELETE', '/topics/billing/answering')).json).toMatchObject({
      joined: true,
      answering: false,
    })
    await ben.api('PUT', '/topics/billing/answering')
    expect((await ben.api('DELETE', '/topics/billing/membership')).json).toMatchObject({
      joined: false,
      answering: false,
    })
    expect((await billing(ana)).helperCount).toBe(0)
    expect((await benAgent.api('PUT', '/topics/billing/answering')).status).toBe(403)
  })

  it('answers only for someone in the room', async () => {
    const refused = await ben.api('PUT', '/topics/billing/answering')
    expect([refused.status, refused.json.error.message]).toEqual([
      409,
      'Join the topic before answering questions in it.',
    ])
    expect((await billing(ben)).answering).toBe(false)
  })

  it('lists on a profile exactly the topics where answering is on', async () => {
    await ben.api('PUT', '/topics/billing/membership', {})
    const chips = async () =>
      (await cy.api('GET', '/directory')).json.entries.find((entry: any) => entry.member.name === 'Ben')
        .topics
    expect(await chips()).toEqual(['lobby'])
    await ben.api('PUT', '/topics/billing/answering')
    expect(await chips()).toEqual(['billing', 'lobby'])
  })

  it('discards the waiting drafts of a person who leaves the room', async () => {
    await ben.api('PUT', '/topics/billing/membership', {})
    const draft = (await benAgent.api('POST', '/drafts', { topic: 'billing', body: 'Half a thought' })).json
    const cursor = (await ben.api('GET', '/events/poll')).json.cursor
    await ben.api('DELETE', '/topics/billing/membership')
    expect((await ben.api('GET', '/drafts')).json.drafts).toEqual([])
    expect(
      (await ben.api('GET', `/events/poll?after=${cursor}`)).json.events.map((event: any) => event.body),
    ).toEqual([
      { type: 'draft.discarded', noteId: draft.id, conversationId: draft.conversationId },
      { type: 'topic.left', slug: 'billing', conversationId: draft.conversationId },
    ])
  })
})
