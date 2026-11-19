import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let anaAgent: Agent
let benAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
})

afterEach(() => server.close())

const send = async (author: Session, to: Session, body: string) => {
  const draft = (await author.api('POST', '/drafts', { to: [to.me.member.id], body })).json
  return (await author.api('POST', `/drafts/${draft.id}/send`, {})).json
}

describe('approval', () => {
  it('moves a draft to sent exactly once and delivers it to every recipient', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'hello' })).json
    server.clock.advance(5_000)
    await server.clock.flush()
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, {})).json
    expect(sent).toMatchObject({ status: 'sent', origin: 'agent', body: 'hello' })
    expect(sent.sentAt).toBeGreaterThan(sent.createdAt)
    expect(sent.receipts).toEqual([
      {
        memberId: ben.me.member.id,
        state: 'delivered',
        deliveredAt: sent.sentAt,
        readAt: null,
        draftingAt: null,
        repliedAt: null,
      },
    ])
    expect((await ana.api('POST', `/drafts/${draft.id}/send`, {})).status).toBe(409)
    expect((await ana.api('POST', `/drafts/${draft.id}/discard`)).status).toBe(409)
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, { body: 'late edit' })).status).toBe(409)
  })

  it('marks a note the person rewrote before sending as human edited', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'agent words' }))
      .json
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, { body: 'my words' })).json
    expect(sent).toMatchObject({ body: 'my words', origin: 'human_edited', agentName: 'Ana agent' })
    const unchanged = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'same' })).json
    expect((await ana.api('POST', `/drafts/${unchanged.id}/send`, { body: 'same' })).json.origin).toBe(
      'agent',
    )
  })

  it('discards a draft for good', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'never mind' })).json
    expect((await ana.api('POST', `/drafts/${draft.id}/discard`)).json.status).toBe('discarded')
    expect((await ana.api('POST', `/drafts/${draft.id}/send`, {})).status).toBe(409)
    expect((await ana.api('GET', '/drafts')).json.drafts).toEqual([])
    expect((await ana.api('GET', `/notes/${draft.id}`)).json.status).toBe('discarded')
    expect((await ana.api('GET', `/conversations/${draft.conversationId}/notes`)).json.notes).toEqual([])
  })

  it('answers 404 for a draft that does not exist and 400 for a malformed id', async () => {
    expect((await ana.api('POST', '/drafts/note_doesnotexist00/send', {})).status).toBe(404)
    expect((await ana.api('POST', '/drafts/not-an-id/send', {})).status).toBe(400)
  })
})

describe('several agents answering one note', () => {
  it('lets each agent draft, and sending one discards the others', async () => {
    const note = await send(ana, ben, 'question')
    const second = await connectAgent(server, ben, { name: 'Ben second agent' })
    const a = (await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: 'answer A' })).json
    const b = (await second.api('POST', '/drafts', { inReplyTo: note.id, body: 'answer B' })).json
    const waiting = (await ben.api('GET', '/drafts')).json.drafts
    expect(waiting.map((draft: any) => [draft.agentName, draft.inReplyTo]).sort()).toEqual([
      ['Ben agent', note.id],
      ['Ben second agent', note.id],
    ])
    await ben.api('POST', `/drafts/${b.id}/send`, {})
    expect((await ben.api('GET', `/notes/${a.id}`)).json.status).toBe('discarded')
    expect((await ben.api('GET', '/drafts')).json.drafts).toEqual([])
    const thread = (await ana.api('GET', `/conversations/${note.conversationId}/notes`)).json.notes
    expect(thread.map((entry: any) => entry.body)).toEqual(['question', 'answer B'])
  })
})
