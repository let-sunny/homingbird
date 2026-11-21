import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  asShown,
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
  return (await author.api('POST', `/drafts/${draft.id}/send`, await asShown(author, draft.id))).json
}

const inboxOf = async (agent: Agent) =>
  (await agent.api('GET', '/inbox')).json.items.map((item: any) => item.note.body)

describe('channels', () => {
  it('starts with exactly the seeded channels', async () => {
    expect(
      (await channels(ana)).map((channel) => [
        channel.slug,
        channel.description,
        channel.helperCount,
        channel.answering,
      ]),
    ).toEqual([
      ['lobby', 'Anything else', 3, true],
      ['billing', 'Invoices and payments', 0, false],
    ])
    expect((await channels(anaAgent, '?q=invoice')).map((channel) => channel.slug)).toEqual(['billing'])
  })

  it('lists the channels I am in first, then the fullest, then by name, a page at a time', async () => {
    for (const slug of ['alpha', 'beta', 'gamma'])
      await ana.api('POST', '/channels', { slug, description: `About ${slug}` })
    await ben.api('PUT', '/channels/gamma/membership', {})
    await cy.api('PUT', '/channels/gamma/membership', {})
    await ben.api('PUT', '/channels/billing/membership', {})
    await cy.api('DELETE', '/channels/lobby/membership')
    const page = async (who: Session, query: string) => (await who.api('GET', `/channels${query}`)).json
    expect((await page(ben, '')).channels.map((channel: any) => channel.slug)).toEqual([
      'gamma',
      'lobby',
      'billing',
      'alpha',
      'beta',
    ])
    const first = await page(ben, '?limit=2')
    expect([first.channels.map((channel: any) => channel.slug), first.hasMore, first.cursor]).toEqual([
      ['gamma', 'lobby'],
      true,
      '2',
    ])
    const last = await page(ben, '?limit=2&cursor=4')
    expect([last.channels.map((channel: any) => channel.slug), last.hasMore, last.cursor]).toEqual([
      ['beta'],
      false,
      null,
    ])
    expect((await page(ben, '?q=about')).channels.map((channel: any) => channel.slug)).toEqual([
      'gamma',
      'alpha',
      'beta',
    ])
    expect((await ben.api('GET', '/channels?limit=0')).json.channels).toHaveLength(1)
    expect((await ben.api('GET', '/channels?limit=x')).status).toBe(400)
  })

  it('adds a new member to no channel', async () => {
    const dee = await server.signIn('dee@example.com', 'Dee')
    expect((await channels(dee)).map((channel) => [channel.slug, channel.joined, channel.answering])).toEqual(
      [
        ['lobby', false, false],
        ['billing', false, false],
      ],
    )
    const entries = (await dee.api('GET', '/directory')).json.entries
    expect(entries.find((entry: any) => entry.member.name === 'Dee').channels).toEqual([])
  })

  it('lets any person create a channel and become its first member, manager and helper', async () => {
    const created = await ben.api('POST', '/channels', { slug: 'deploys', description: 'Release process' })
    expect(created.json).toMatchObject({
      slug: 'deploys',
      visibility: 'open',
      memberCount: 1,
      helperCount: 1,
      joined: true,
      answering: true,
      managing: true,
    })
    const again = await ana.api('POST', '/channels', { slug: 'deploys', description: 'again' })
    expect([again.status, again.json.error.message]).toEqual([409, 'That name is not available.'])
    expect((await ana.api('POST', '/channels', { slug: 'Not A Slug', description: 'x' })).status).toBe(400)
    expect((await anaAgent.api('POST', '/channels', { slug: 'by-agent', description: 'x' })).status).toBe(403)
    const room = (await ben.api('GET', `/conversations/${created.json.conversationId}`)).json
    expect(room).toMatchObject({ kind: 'channel', title: 'deploys', participantIds: [ben.me.member.id] })
  })

  it('creates a channel without a description', async () => {
    const created = await ben.api('POST', '/channels', { slug: 'oncall', description: '' })
    expect([created.status, created.json.description]).toEqual([200, ''])
  })

  it('shows on a profile which channels a member helps with, and filters the directory by channel', async () => {
    await ben.api('PUT', '/channels/billing/membership', { answering: true })
    const entries = (await ana.api('GET', '/directory')).json.entries
    expect(Object.fromEntries(entries.map((entry: any) => [entry.member.name, entry.channels]))).toEqual({
      Ana: ['lobby'],
      Ben: ['billing', 'lobby'],
      Cy: ['lobby'],
    })
    const helpers = (await anaAgent.api('GET', '/directory?channel=billing')).json.entries
    expect(helpers.map((entry: any) => entry.member.name)).toEqual(['Ben'])
    await ben.api('DELETE', '/channels/billing/membership')
    expect((await ana.api('GET', '/directory?channel=billing')).json.entries).toEqual([])
    expect((await ben.api('PUT', '/channels/nowhere/membership', { answering: true })).status).toBe(404)
    expect((await benAgent.api('PUT', '/channels/billing/membership', { answering: true })).status).toBe(403)
  })
})

describe('asking a channel', () => {
  beforeEach(async () => {
    await ben.api('PUT', '/channels/billing/membership', { answering: true })
    await cy.api('PUT', '/channels/billing/membership', { answering: true })
  })

  it('delivers the question to every helper and lets the asker follow the room', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { channel: 'billing', body: 'Who owns refunds?' }))
      .json
    expect((await ben.api('GET', `/notes/${draft.id}`)).status).toBe(404)
    const note = (await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).json
    expect(note.receipts.map((receipt: any) => receipt.memberId).sort()).toEqual(
      [ben.me.member.id, cy.me.member.id].sort(),
    )
    expect(await inboxOf(benAgent)).toEqual(['Who owns refunds?'])
    expect(await inboxOf(cyAgent)).toEqual(['Who owns refunds?'])
    expect((await ana.api('GET', `/conversations/${note.conversationId}`)).json.kind).toBe('channel')
    expect((await channels(ana)).find((channel) => channel.slug === 'billing')).toMatchObject({
      answering: false,
      helperCount: 2,
    })
  })

  it('answers the asker only, and takes the question off the other helpers’ plates', async () => {
    const question = await ask(ana, 'billing', 'Who owns refunds?')
    const draft = (await benAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Ben does.' })).json
    expect(await inboxOf(cyAgent)).toEqual(['Who owns refunds?'])
    const answer = (await ben.api('POST', `/drafts/${draft.id}/send`, await asShown(ben, draft.id))).json
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

  it('keeps a channel room closed to members who never joined or asked', async () => {
    const outsider = await server.signIn('dee@example.com', 'Dee')
    const question = await ask(ana, 'billing', 'Who owns refunds?')
    expect((await outsider.api('GET', `/notes/${question.id}`)).status).toBe(404)
    expect((await outsider.api('GET', `/conversations/${question.conversationId}/notes`)).status).toBe(404)
    expect((await outsider.api('GET', '/search?q=refunds')).json.notes).toEqual([])
  })

  it('refuses a channel that does not exist and reaches everyone who answers in the one named', async () => {
    expect((await ana.api('POST', '/drafts', { channel: 'nowhere', body: 'hello?' })).status).toBe(404)
    const note = await ask(ana, 'lobby', 'Anyone know the wifi password?')
    expect(note.receipts).toHaveLength(2)
  })

  it('accepts a draft request addressed to a channel', async () => {
    const request = (
      await ana.api('POST', '/draft-requests', { channel: 'billing', instruction: 'Ask about refunds' })
    ).json
    const draft = (
      await anaAgent.api('POST', '/drafts', { requestId: request.id, body: 'Who owns refunds?' })
    ).json
    expect(draft.conversationId).toBe(request.conversationId)
  })
})

describe('moving a question to a better channel', () => {
  beforeEach(async () => {
    await ben.api('PUT', '/channels/billing/membership', { answering: true })
  })

  it('takes it from the helpers of the old channel and gives it to the helpers of the new one', async () => {
    const question = await ask(ana, 'lobby', 'Who owns refunds?')
    expect(await inboxOf(cyAgent)).toEqual(['Who owns refunds?'])
    const reply = (await cyAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Not me, but…' }))
      .json
    const cursor = (await cy.api('GET', '/events/poll')).json.cursor
    const moved = (await cy.api('POST', `/notes/${question.id}/move`, { channel: 'billing' })).json
    const billing = (await channels(ana)).find((channel) => channel.slug === 'billing')
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
    const moved = (await cy.api('POST', `/notes/${question.id}/move`, { channel: 'billing' })).json

    expect((await cy.api('GET', '/drafts')).json.drafts).toEqual([])
    expect((await cy.api('POST', `/drafts/${outside.id}/send`, await asShown(cy, outside.id))).status).toBe(
      409,
    )
    const kept = (await ben.api('GET', `/notes/${inside.id}`)).json
    expect(kept).toMatchObject({ status: 'draft', conversationId: moved.conversationId, body: 'I do.' })
    const benEvents = (await ben.api('GET', `/events/poll?after=${benCursor}`)).json.events
    expect(benEvents.map((event: any) => event.body.type)).toEqual(['note.moved', 'note.sent', 'draft.saved'])
    expect(benEvents[2].body.note).toEqual(kept)
    expect(moved.receipts).toMatchObject([{ memberId: ben.me.member.id, state: 'drafting' }])

    const sent = (await ben.api('POST', `/drafts/${inside.id}/send`, await asShown(ben, inside.id))).json
    expect(sent).toMatchObject({ status: 'sent', conversationId: moved.conversationId })
    expect((await ana.api('GET', `/notes/${sent.id}`)).json.body).toBe('I do.')
  })

  it('moves only an unanswered question, only between channels, and only by a person in the room', async () => {
    const question = await ask(ana, 'lobby', 'Who owns refunds?')
    const outsider = await server.signIn('dee@example.com', 'Dee')
    expect((await outsider.api('POST', `/notes/${question.id}/move`, { channel: 'billing' })).status).toBe(
      404,
    )
    expect((await cyAgent.api('POST', `/notes/${question.id}/move`, { channel: 'billing' })).status).toBe(403)
    expect((await cy.api('POST', `/notes/${question.id}/move`, { channel: 'lobby' })).status).toBe(409)
    expect((await cy.api('POST', `/notes/${question.id}/move`, { channel: 'nowhere' })).status).toBe(404)
    const answer = (await cy.api('POST', '/drafts', { inReplyTo: question.id, body: 'Ben does.' })).json
    await cy.api('POST', `/drafts/${answer.id}/send`, await asShown(cy, answer.id))
    expect((await cy.api('POST', `/notes/${question.id}/move`, { channel: 'billing' })).status).toBe(409)
    expect((await ana.api('POST', `/notes/${answer.id}/move`, { channel: 'billing' })).status).toBe(409)
    const direct = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'direct' })).json
    await ana.api('POST', `/drafts/${direct.id}/send`, await asShown(ana, direct.id))
    expect((await ben.api('POST', `/notes/${direct.id}/move`, { channel: 'billing' })).status).toBe(409)
  })
})

describe('re-addressing a draft question', () => {
  beforeEach(async () => {
    await ben.api('PUT', '/channels/billing/membership', { answering: true })
  })

  it('moves an agent’s draft to another channel room, keeping its id, origin and agent name', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { channel: 'lobby', body: 'Who owns refunds?' }))
      .json
    const cursor = (await ana.api('GET', '/events/poll')).json.cursor
    const moved = (await ana.api('PATCH', `/drafts/${draft.id}`, { channel: 'billing' })).json
    const billing = (await channels(ana)).find((channel) => channel.slug === 'billing')
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
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).json
    expect(sent.receipts.map((receipt: any) => receipt.memberId)).toEqual([ben.me.member.id])
    expect(await inboxOf(cyAgent)).toEqual([])
  })

  it('changes the text and the channel in one step, and marks a person’s change to the text', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { channel: 'lobby', body: 'Refunds?' })).json
    const moved = (
      await ana.api('PATCH', `/drafts/${draft.id}`, { channel: 'billing', body: 'Who owns refunds?' })
    ).json
    expect(moved).toMatchObject({ body: 'Who owns refunds?', origin: 'human_edited', agentName: 'Ana agent' })
  })

  it('lets the drafting agent re-address its own draft, which the person still sees before approving', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { channel: 'lobby', body: 'Who owns refunds?' }))
      .json
    const moved = (await anaAgent.api('PATCH', `/drafts/${draft.id}`, { channel: 'billing' })).json
    expect(moved).toMatchObject({ id: draft.id, status: 'draft', origin: 'agent' })
    expect((await ana.api('GET', '/drafts')).json.drafts.map((each: any) => each.conversationId)).toEqual([
      moved.conversationId,
    ])
  })

  it('keeps a draft request answer linked to its request', async () => {
    const request = (await ana.api('POST', '/draft-requests', { channel: 'lobby', instruction: 'Ask' })).json
    const draft = (
      await anaAgent.api('POST', '/drafts', { requestId: request.id, body: 'Who owns refunds?' })
    ).json
    await ana.api('PATCH', `/drafts/${draft.id}`, { channel: 'billing' })
    const requests = (await ana.api('GET', '/draft-requests')).json.requests
    expect(requests.find((each: any) => each.id === request.id)?.draftIds).toEqual([draft.id])
  })

  it('re-addresses only an unsent question drafted to a channel, and only to a channel that exists', async () => {
    const question = await ask(cy, 'lobby', 'Who owns refunds?')
    const reply = (await ana.api('POST', '/drafts', { inReplyTo: question.id, body: 'Ben does.' })).json
    expect((await ana.api('PATCH', `/drafts/${reply.id}`, { channel: 'billing' })).status).toBe(409)
    const direct = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'direct' })).json
    expect((await ana.api('PATCH', `/drafts/${direct.id}`, { channel: 'billing' })).status).toBe(409)
    const draft = (await ana.api('POST', '/drafts', { channel: 'lobby', body: 'Who owns refunds?' })).json
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, { channel: 'nowhere' })).status).toBe(404)
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, {})).status).toBe(400)
    expect((await ben.api('PATCH', `/drafts/${draft.id}`, { channel: 'billing' })).status).toBe(404)
    await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, { channel: 'billing' })).status).toBe(409)
    expect((await ana.api('PATCH', `/notes/${question.id}`, { channel: 'billing' })).status).toBe(404)
  })
})

describe('seed channels', () => {
  const channelsFor = (value?: string) => {
    const config = loadConfig({
      HB_PUBLIC_URL: 'http://localhost:8080',
      HB_DEV_LOGIN: '1',
      ...(value !== undefined && { HB_CHANNELS: value }),
    })
    return config._tag === 'Ok'
      ? config.value.channels.map((channel) => `${channel.slug}=${channel.description}`)
      : config.error
  }

  it('hold exactly the listed channels, read as slug:description pairs', () => {
    expect(channelsFor()).toEqual([])
    expect(channelsFor('billing: Invoices: and payments, infra')).toEqual([
      'billing=Invoices: and payments',
      'infra=infra',
    ])
    expect(channelsFor('general: Start here')).toEqual(['general=Start here'])
  })

  it('refuse a name that could not be a channel', () => {
    expect(channelsFor('Not A Slug')).toEqual([expect.stringContaining('HB_CHANNELS')])
  })
})

describe('joining a channel and answering in it', () => {
  const billing = async (who: Session) => (await who.api('GET', '/channels/billing')).json

  it('joins a room without answering, so its questions reach only the people who answer there', async () => {
    const joined = (await ben.api('PUT', '/channels/billing/membership', {})).json
    expect(joined).toMatchObject({ joined: true, answering: false, memberCount: 1, helperCount: 0 })
    await cy.api('PUT', '/channels/billing/membership', { answering: true })
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
    await ben.api('PUT', '/channels/billing/membership', {})
    expect((await ben.api('PUT', '/channels/billing/answering')).json).toMatchObject({ answering: true })
    expect((await ben.api('DELETE', '/channels/billing/answering')).json).toMatchObject({
      joined: true,
      answering: false,
    })
    await ben.api('PUT', '/channels/billing/answering')
    expect((await ben.api('DELETE', '/channels/billing/membership')).json).toMatchObject({
      joined: false,
      answering: false,
    })
    expect((await billing(ana)).helperCount).toBe(0)
    expect((await benAgent.api('PUT', '/channels/billing/answering')).status).toBe(403)
  })

  it('answers only for someone in the room', async () => {
    const refused = await ben.api('PUT', '/channels/billing/answering')
    expect([refused.status, refused.json.error.message]).toEqual([
      409,
      'Join the channel before answering questions in it.',
    ])
    expect((await billing(ben)).answering).toBe(false)
  })

  it('lists on a profile exactly the channels where answering is on', async () => {
    await ben.api('PUT', '/channels/billing/membership', {})
    const chips = async () =>
      (await cy.api('GET', '/directory')).json.entries.find((entry: any) => entry.member.name === 'Ben')
        .channels
    expect(await chips()).toEqual(['lobby'])
    await ben.api('PUT', '/channels/billing/answering')
    expect(await chips()).toEqual(['billing', 'lobby'])
  })

  it('discards the waiting drafts of a person who leaves the room', async () => {
    await ben.api('PUT', '/channels/billing/membership', {})
    const draft = (await benAgent.api('POST', '/drafts', { channel: 'billing', body: 'Half a thought' })).json
    const cursor = (await ben.api('GET', '/events/poll')).json.cursor
    await ben.api('DELETE', '/channels/billing/membership')
    expect((await ben.api('GET', '/drafts')).json.drafts).toEqual([])
    expect(
      (await ben.api('GET', `/events/poll?after=${cursor}`)).json.events.map((event: any) => event.body),
    ).toEqual([
      { type: 'draft.discarded', noteId: draft.id, conversationId: draft.conversationId },
      { type: 'channel.left', slug: 'billing', conversationId: draft.conversationId },
    ])
  })
})

describe('the managers of a new channel', () => {
  it('are a channel group of its creator alone, and of nobody for a configured channel', async () => {
    const made = (await ben.api('POST', '/channels', { slug: 'payroll', description: 'Salaries' })).json
    const groups = await storedRows(server, 'member_groups')
    expect(groups.find((row) => row.id === made.managedBy)).toMatchObject({
      kind: 'channel',
      name: null,
      created_by: ben.me.member.id,
    })
    const lobby = (await ana.api('GET', '/channels/lobby')).json.managedBy
    expect(groups.find((row) => row.id === lobby)).toMatchObject({ kind: 'channel', created_by: null })
    expect((await storedRows(server, 'group_members')).filter((row) => row.group_id === lobby)).toEqual([])
  })

  it('lose their last member from the group too when that member leaves the room, so no one manages it from outside', async () => {
    const made = (await ben.api('POST', '/channels', { slug: 'ops', description: 'Operations' })).json
    const told: unknown[] = []
    const { broadcast } = server.env.hub
    ;(server.env.hub as { broadcast: typeof broadcast }).broadcast = (event) => {
      if (event.body.type === 'group.changed') told.push(event.body)
      broadcast(event)
    }
    expect((await ben.api('DELETE', '/channels/ops/membership')).json.joined).toBe(false)
    expect(
      (await storedRows(server, 'group_members')).filter((row) => row.group_id === made.managedBy),
    ).toEqual([])
    expect(told).toEqual([{ type: 'group.changed', groupId: made.managedBy }])
    await cy.api('PUT', '/channels/ops/membership', {})
    expect((await cy.api('DELETE', '/channels/ops/membership')).json.joined).toBe(false)
  })
})
