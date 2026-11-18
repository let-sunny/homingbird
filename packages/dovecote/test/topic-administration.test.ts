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
  server = await startTestServer({ HB_TOPICS: 'billing: Invoices and payments, general: Anything else' })
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
    await ben.api('PUT', '/topics/payments/membership', { answering: true })
    expect((await ben.api('GET', `/conversations/${renamed.conversationId}`)).json.title).toBe('payments')
    expect((await ana.api('PATCH', '/admin/topics/payments', { slug: 'general' })).status).toBe(409)
    expect((await ana.api('PATCH', '/admin/topics/general', { slug: 'lobby' })).json.slug).toBe('lobby')
    expect((await ana.api('PATCH', '/admin/topics/nowhere', { description: 'x' })).status).toBe(404)
  })

  it('merges one topic into another, keeping the helpers and the old room’s notes', async () => {
    await ana.api('POST', '/topics', { slug: 'invoices', description: 'Duplicate of billing' })
    await ben.api('PUT', '/topics/invoices/membership', { answering: true })
    const old = await ask(cy, 'invoices', 'Old question')
    const merged = (await ana.api('POST', '/admin/topics/invoices/merge', { into: 'billing' })).json
    expect(merged).toMatchObject({ slug: 'billing', helperCount: 2, answering: true })
    expect((await topics(ana)).map((topic) => topic.slug)).toEqual(['billing', 'general'])
    expect((await ben.api('GET', `/conversations/${old.conversationId}`)).json).toMatchObject({
      kind: 'group',
      title: 'invoices',
      archivedAt: expect.any(Number),
    })
    expect((await ana.api('POST', '/admin/topics/billing/merge', { into: 'billing' })).status).toBe(409)
    expect((await ana.api('POST', '/admin/topics/general/merge', { into: 'billing' })).json.slug).toBe(
      'billing',
    )
  })

  it('removes any topic, including one named general, and marks its old room as archived', async () => {
    const billing = await ben.api('PUT', '/topics/billing/membership', { answering: true })
    expect((await ana.api('DELETE', '/admin/topics/billing')).status).toBe(200)
    expect((await ben.api('GET', `/conversations/${billing.json.conversationId}`)).json).toMatchObject({
      kind: 'group',
      title: 'billing',
      archivedAt: expect.any(Number),
    })
    expect((await ana.api('DELETE', '/admin/topics/billing')).status).toBe(404)
    expect((await ana.api('DELETE', '/admin/topics/general')).status).toBe(200)
  })
})

describe('an archived room', () => {
  const ARCHIVED = 'This conversation is archived: it can be read, but nothing more can be written in it.'

  it('stays readable for its participants, refuses every new note, and discards the drafts waiting in it', async () => {
    await ben.api('PUT', '/topics/billing/membership', { answering: true })
    const question = await ask(cy, 'billing', 'Who owns refunds?')
    const waitingReply = (await benAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Ben' })).json
    const waitingQuestion = (
      await cyAgent.api('POST', '/drafts', { topic: 'billing', body: 'And invoices?' })
    ).json
    const benCursor = (await ben.api('GET', '/events/poll')).json.cursor
    expect((await ana.api('DELETE', '/admin/topics/billing')).status).toBe(200)
    const room = question.conversationId

    expect(
      (await ben.api('GET', `/events/poll?after=${benCursor}`)).json.events.map((event: any) => event.body),
    ).toContainEqual({
      type: 'draft.discarded',
      noteId: waitingReply.id,
      conversationId: room,
    })
    expect((await cy.api('GET', `/notes/${waitingQuestion.id}`)).json.status).toBe('discarded')
    expect(
      (await ben.api('GET', `/conversations/${room}/notes`)).json.notes.map((note: any) => note.body),
    ).toEqual(['Who owns refunds?'])

    for (const attempt of [
      await benAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Late answer' }),
      await cy.api('POST', '/drafts', { conversationId: room, body: 'Anyone?' }),
    ])
      expect([attempt.status, attempt.json.error.message]).toEqual([409, ARCHIVED])
    expect((await ben.api('POST', `/drafts/${waitingReply.id}/send`, {})).status).toBe(409)
    expect((await cy.api('POST', `/notes/${question.id}/move`, { topic: 'general' })).status).toBe(409)
    expect((await ana.api('PUT', `/topics/billing/members/${ben.me.member.id}`)).status).toBe(404)
  })

  it('refuses to send a draft that was written before the room was archived', async () => {
    await ben.api('PUT', '/topics/billing/membership', { answering: true })
    const question = await ask(cy, 'billing', 'Who owns refunds?')
    const reply = (await ben.api('POST', '/drafts', { inReplyTo: question.id, body: 'Ben does.' })).json
    await ana.api('DELETE', '/admin/topics/billing')
    const refused = await ben.api('POST', `/drafts/${reply.id}/send`, {})
    expect(refused.status).toBe(409)
  })
})
