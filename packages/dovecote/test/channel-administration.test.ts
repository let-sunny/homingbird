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
  storeChannelAsPrivate,
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
  server = await startTestServer({ HB_CHANNELS: 'billing: Invoices and payments, general: Anything else' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
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

describe('tidying channels', () => {
  it('is reserved for administrators', async () => {
    expect((await ben.api('PATCH', '/admin/channels/billing', { description: 'mine now' })).status).toBe(403)
    expect((await ben.api('POST', '/admin/channels/billing/archive', {})).status).toBe(403)
    expect(
      (await ben.api('POST', '/admin/channels/billing/archive', { moveMembersTo: 'general' })).status,
    ).toBe(403)
    expect((await benAgent.api('POST', '/admin/channels/billing/archive', {})).status).toBe(403)
  })

  it('renames a channel together with its room', async () => {
    const renamed = (
      await ana.api('PATCH', '/admin/channels/billing', { slug: 'payments', description: 'Money in and out' })
    ).json
    expect(renamed).toMatchObject({ slug: 'payments', description: 'Money in and out' })
    await ben.api('PUT', '/channels/payments/membership', { answering: true })
    expect((await ben.api('GET', `/conversations/${renamed.conversationId}`)).json.title).toBe('payments')
    expect((await ana.api('PATCH', '/admin/channels/payments', { slug: 'general' })).status).toBe(409)
    expect((await ana.api('PATCH', '/admin/channels/general', { slug: 'lobby' })).json.slug).toBe('lobby')
    expect((await ana.api('PATCH', '/admin/channels/nowhere', { description: 'x' })).status).toBe(404)
  })

  it('archives a channel and moves its members to another, keeping the answerers and the old room’s notes where they are', async () => {
    await ana.api('POST', '/channels', { slug: 'invoices', description: 'Duplicate of billing' })
    await ben.api('PUT', '/channels/invoices/membership', { answering: true })
    const old = await ask(cy, 'invoices', 'Old question')
    expect(
      (await ana.api('POST', '/admin/channels/invoices/archive', { moveMembersTo: 'billing' })).status,
    ).toBe(200)
    expect((await channels(ana)).map((channel) => channel.slug)).toEqual(['billing', 'general'])
    expect((await channels(ben)).find((channel) => channel.slug === 'billing')).toMatchObject({
      answering: true,
      joined: true,
    })
    expect((await ben.api('GET', `/conversations/${old.conversationId}`)).json).toMatchObject({
      kind: 'group',
      title: 'invoices',
      archivedAt: expect.any(Number),
    })
    expect(
      (await ben.api('GET', `/conversations/${old.conversationId}/notes`)).json.notes.map(
        (note: any) => note.body,
      ),
    ).toEqual(['Old question'])
    const billingRoom = (await ben.api('GET', '/channels/billing')).json.conversationId
    expect(
      (await ben.api('GET', `/conversations/${billingRoom}/notes`)).json.notes.map((note: any) => note.body),
    ).not.toContain('Old question')
    expect(
      (await ana.api('POST', '/admin/channels/billing/archive', { moveMembersTo: 'billing' })).status,
    ).toBe(409)
    expect((await ana.api('POST', '/admin/channels/nowhere/archive', {})).status).toBe(404)
    expect(
      (await ana.api('POST', '/admin/channels/general/archive', { moveMembersTo: 'nowhere' })).status,
    ).toBe(404)
    expect((await channels(ana)).map((channel) => channel.slug)).toEqual(['billing', 'general'])
  })

  it('archives any channel without moving anyone, including one named general', async () => {
    const billing = await ben.api('PUT', '/channels/billing/membership', { answering: true })
    expect((await ana.api('POST', '/admin/channels/billing/archive', {})).status).toBe(200)
    expect((await ben.api('GET', `/conversations/${billing.json.conversationId}`)).json).toMatchObject({
      kind: 'group',
      title: 'billing',
      archivedAt: expect.any(Number),
    })
    expect((await ana.api('POST', '/admin/channels/billing/archive', {})).status).toBe(404)
    expect((await ana.api('POST', '/admin/channels/general/archive', {})).status).toBe(200)
  })

  it('never moves the members of a private channel, or anyone into one, unless both have the same members', async () => {
    await ana.api('POST', '/channels', { slug: 'secret', description: 'Private' })
    await ana.api('PUT', `/channels/secret/members/${ben.me.member.id}`)
    await storeChannelAsPrivate(server, 'secret')
    await cy.api('PUT', '/channels/general/membership', { answering: false })
    for (const [from, to] of [
      ['secret', 'general'],
      ['general', 'secret'],
    ]) {
      const refused = await ana.api('POST', `/admin/channels/${from}/archive`, { moveMembersTo: to })
      expect([from, refused.status]).toEqual([from, 409])
    }
    expect((await channels(ana)).map((channel) => channel.slug).sort()).toEqual([
      'billing',
      'general',
      'secret',
    ])
    expect((await cy.api('GET', '/channels/secret')).status).toBe(404)
  })
})

describe('an archived room', () => {
  const ARCHIVED =
    'No reply is possible: this channel was archived. It can still be read, but nothing more can be written in it, here or in the web client.'

  it('stays readable for its participants, refuses every new note, and discards the drafts waiting in it', async () => {
    await ben.api('PUT', '/channels/billing/membership', { answering: true })
    const question = await ask(cy, 'billing', 'Who owns refunds?')
    const waitingReply = (await benAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Ben' })).json
    const waitingQuestion = (
      await cyAgent.api('POST', '/drafts', { channel: 'billing', body: 'And invoices?' })
    ).json
    const benCursor = (await ben.api('GET', '/events/poll')).json.cursor
    expect((await ana.api('POST', '/admin/channels/billing/archive', {})).status).toBe(200)
    const room = question.conversationId

    expect(
      (await ben.api('GET', `/events/poll?after=${benCursor}`)).json.events.map((event: any) => event.body),
    ).toContainEqual({
      type: 'draft.discarded',
      noteId: waitingReply.id,
      conversationId: room,
      because: 'channel_archived',
      channel: 'billing',
    })
    const noticesOf = async (who: Session) =>
      (await who.api('GET', `/conversations/${room}/notes`)).json.notices.map((notice: any) => [
        notice.kind,
        notice.noteId,
        notice.channel,
      ])
    expect(await noticesOf(ben)).toEqual([['channel_archived', waitingReply.id, 'billing']])
    expect(await noticesOf(cy)).toEqual([['channel_archived', waitingQuestion.id, 'billing']])
    expect((await cy.api('GET', `/notes/${waitingQuestion.id}`)).json.status).toBe('discarded')
    expect(
      (await ben.api('GET', `/conversations/${room}/notes`)).json.notes.map((note: any) => note.body),
    ).toEqual(['Who owns refunds?'])

    for (const attempt of [
      await benAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Late answer' }),
      await cy.api('POST', '/drafts', { conversationId: room, body: 'Anyone?' }),
    ])
      expect([attempt.status, attempt.json.error.message]).toEqual([409, ARCHIVED])
    expect(
      (await ben.api('POST', `/drafts/${waitingReply.id}/send`, await asShown(ben, waitingReply.id))).status,
    ).toBe(409)
    expect((await ana.api('PUT', `/channels/billing/members/${ben.me.member.id}`)).status).toBe(404)
  })

  it('stops showing an agent as drafting there, so nobody waits for a reply that cannot come', async () => {
    await ben.api('PUT', '/channels/billing/membership', { answering: true })
    const question = await ask(cy, 'billing', 'Who owns refunds?')
    await benAgent.api('POST', `/notes/${question.id}/pickup`)
    expect((await cy.api('GET', `/notes/${question.id}`)).json.receipts[0].state).toBe('drafting')
    const cyCursor = (await cy.api('GET', '/events/poll')).json.cursor

    await ana.api('POST', '/admin/channels/billing/archive', {})

    expect((await cy.api('GET', `/notes/${question.id}`)).json.receipts[0].state).toBe('delivered')
    expect(await storedRows(server, 'pickups')).toEqual([])
    expect(
      (await cy.api('GET', `/events/poll?after=${cyCursor}`)).json.events.map(
        (event: any) => event.body.type,
      ),
    ).toContain('note.status')
  })

  it('refuses to send a draft that was written before the room was archived', async () => {
    await ben.api('PUT', '/channels/billing/membership', { answering: true })
    const question = await ask(cy, 'billing', 'Who owns refunds?')
    const reply = (await ben.api('POST', '/drafts', { inReplyTo: question.id, body: 'Ben does.' })).json
    await ana.api('POST', '/admin/channels/billing/archive', {})
    const refused = await ben.api('POST', `/drafts/${reply.id}/send`, await asShown(ben, reply.id))
    expect(refused.status).toBe(409)
  })
})

describe('telling who manages a channel that it changed', () => {
  const groupEvents = () => {
    const told: Array<readonly [string, string]> = []
    const hub = server.env.hub as {
      broadcast: typeof server.env.hub.broadcast
      publish: typeof server.env.hub.publish
    }
    const { broadcast, publish } = hub
    hub.broadcast = (event) => {
      if (event.body.type === 'group.changed') told.push(['everyone', event.body.groupId])
      broadcast(event)
    }
    hub.publish = (memberId, event) => {
      if (event.body.type === 'group.changed') told.push([memberId, event.body.groupId])
      publish(memberId, event)
    }
    return told
  }

  it('tells everyone when an open channel is renamed or archived', async () => {
    const group = (await ben.api('POST', '/channels', { slug: 'ops', description: 'Operations' })).json
      .managedBy
    const told = groupEvents()
    await ana.api('PATCH', '/admin/channels/ops', { slug: 'operations' })
    await ana.api('POST', '/admin/channels/operations/archive', {})
    expect(told).toEqual([
      ['everyone', group],
      ['everyone', group],
    ])
  })

  it('tells only the room of a private channel, so nobody else learns it changed', async () => {
    const made = { slug: 'payroll', description: 'Salaries', visibility: 'private' }
    const group = (await ben.api('POST', '/channels', made)).json.managedBy
    const told = groupEvents()
    await ana.api('PATCH', '/admin/channels/payroll', { slug: 'salaries' })
    await ana.api('POST', '/admin/channels/salaries/archive', {})
    expect(told).toEqual([
      [ben.me.member.id, group],
      [ben.me.member.id, group],
    ])
  })
})
