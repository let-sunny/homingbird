import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let cy: Session
let benAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
  for (const slug of ['billing', 'support']) await ana.api('POST', '/channels', { slug, description: slug })
  await ben.api('PUT', '/channels/billing/membership', { answering: true })
  await cy.api('PUT', '/channels/support/membership', { answering: true })
})

afterEach(() => server.close())

const ask = async (channel: string, body: string) => {
  const draft = (await ana.api('POST', '/drafts', { channel, body })).json
  return (await ana.api('POST', `/drafts/${draft.id}/send`, {})).json
}

const eventsOf = async (session: Session) =>
  (await session.api('GET', '/events/poll?after=0')).json.events.map((event: any) => event.body)

describe('moving a question to another channel', () => {
  it('delivers it to the helpers there instead, and tells the room it left', async () => {
    const question = await ask('billing', 'Who approves refunds?')
    const moved = await ben.api('POST', `/notes/${question.id}/move`, { channel: 'support' })
    expect(moved.status).toBe(200)
    expect(moved.json.conversationId).not.toBe(question.conversationId)
    expect(moved.json.receipts.map((receipt: any) => receipt.memberId)).toEqual([cy.me.member.id])
    expect(moved.json.sentAt).toBeGreaterThanOrEqual(question.sentAt)
    expect(await eventsOf(ben)).toContainEqual(
      expect.objectContaining({
        type: 'note.moved',
        noteId: question.id,
        toConversationId: moved.json.conversationId,
      }),
    )
    expect(await eventsOf(cy)).toContainEqual(
      expect.objectContaining({ type: 'note.sent', note: expect.objectContaining({ id: question.id }) }),
    )
  })

  it('takes along a reply draft whose author is in the new room and gives up the others', async () => {
    await cy.api('PUT', '/channels/billing/membership', { answering: true })
    const question = await ask('billing', 'Who approves refunds?')
    const staying = (await benAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Finance does.' }))
      .json
    const travelling = (await cy.api('POST', '/drafts', { inReplyTo: question.id, body: 'Support does.' }))
      .json
    const moved = (await ben.api('POST', `/notes/${question.id}/move`, { channel: 'support' })).json
    expect((await cy.api('GET', `/notes/${travelling.id}`)).json).toMatchObject({
      status: 'draft',
      conversationId: moved.conversationId,
    })
    expect((await ben.api('GET', `/notes/${staying.id}`)).json.status).toBe('discarded')
  })

  it('moves only a sent question asked in a channel that nobody answered yet, and only by a person', async () => {
    const question = await ask('billing', 'Who approves refunds?')
    expect((await benAgent.api('POST', `/notes/${question.id}/move`, { channel: 'support' })).status).toBe(
      403,
    )
    expect(
      (await ben.api('POST', `/notes/${question.id}/move`, { channel: 'billing' })).json.error.message,
    ).toBe('The question is already in that channel.')
    const reply = (await ben.api('POST', '/drafts', { inReplyTo: question.id, body: 'Finance.' })).json
    await ben.api('POST', `/drafts/${reply.id}/send`, {})
    expect(
      (await ben.api('POST', `/notes/${question.id}/move`, { channel: 'support' })).json.error.message,
    ).toBe('This question already has an answer here.')
    expect((await ben.api('POST', `/notes/${reply.id}/move`, { channel: 'support' })).status).toBe(409)
    const direct = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Direct' })).json
    await ana.api('POST', `/drafts/${direct.id}/send`, {})
    expect(
      (await ana.api('POST', `/notes/${direct.id}/move`, { channel: 'support' })).json.error.message,
    ).toBe('Only a question asked in a channel can be moved.')
  })
})
