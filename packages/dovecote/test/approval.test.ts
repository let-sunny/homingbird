import { DRAFT_CHANGED } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sql } from '../src/sql/query.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  asShown,
  connectAgent,
  meanwhile,
  startTestServer,
  storedRows,
} from './harness.ts'

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
  return (await author.api('POST', `/drafts/${draft.id}/send`, await asShown(author, draft.id))).json
}

describe('approval', () => {
  it('moves a draft to sent exactly once and delivers it to every recipient', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'hello' })).json
    server.clock.advance(5_000)
    await server.clock.flush()
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).json
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
    expect((await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).status).toBe(409)
    expect((await ana.api('POST', `/drafts/${draft.id}/discard`)).status).toBe(409)
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, { body: 'late edit' })).status).toBe(409)
  })

  it('marks a note the person rewrote before sending as human edited', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'agent words' }))
      .json
    const sent = (
      await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id, { body: 'my words' }))
    ).json
    expect(sent).toMatchObject({ body: 'my words', origin: 'human_edited', agentName: 'Ana agent' })
    const unchanged = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'same' })).json
    expect(
      (
        await ana.api(
          'POST',
          `/drafts/${unchanged.id}/send`,
          await asShown(ana, unchanged.id, { body: 'same' }),
        )
      ).json.origin,
    ).toBe('agent')
  })

  it('discards a draft for good', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'never mind' })).json
    expect((await ana.api('POST', `/drafts/${draft.id}/discard`)).json.status).toBe('discarded')
    expect((await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).status).toBe(409)
    expect((await ana.api('GET', '/drafts')).json.drafts).toEqual([])
    expect((await ana.api('GET', `/notes/${draft.id}`)).json.status).toBe('discarded')
    expect((await ana.api('GET', `/conversations/${draft.conversationId}/notes`)).json.notes).toEqual([])
  })

  it('answers 404 for a draft that does not exist and 400 for a malformed id', async () => {
    expect(
      (await ana.api('POST', '/drafts/note_doesnotexist00/send', await asShown(ana, 'note_doesnotexist00')))
        .status,
    ).toBe(404)
    expect((await ana.api('POST', '/drafts/not-an-id/send', await asShown(ana, 'not-an-id'))).status).toBe(
      400,
    )
  })
})

describe('sending what the person read', () => {
  const asRead = (note: any) => ({ body: note.body, conversationId: note.conversationId })

  it('refuses to send when an agent rewrote the draft after the person read it', async () => {
    const read = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'see you at 3' }))
      .json
    await anaAgent.api('PATCH', `/drafts/${read.id}`, { body: 'wire the money now' })
    const refused = await ana.api('POST', `/drafts/${read.id}/send`, { expected: asRead(read) })
    expect(refused.status).toBe(409)
    expect(refused.json.error.message).toBe('This draft changed; read it again.')
    expect((await ana.api('GET', `/notes/${read.id}`)).json).toMatchObject({
      status: 'draft',
      body: 'wire the money now',
    })
    expect((await ben.api('GET', `/notes/${read.id}`)).status).toBe(404)
  })

  it('refuses to send when an agent moved the draft to another room after the person read it', async () => {
    for (const slug of ['billing', 'support']) await ana.api('POST', '/channels', { slug, description: slug })
    await ben.api('PUT', '/channels/support/membership', { answering: true })
    const read = (await anaAgent.api('POST', '/drafts', { channel: 'billing', body: 'our numbers' })).json
    const moved = (await anaAgent.api('PATCH', `/drafts/${read.id}`, { channel: 'support' })).json
    expect(moved.conversationId).not.toBe(read.conversationId)
    const refused = await ana.api('POST', `/drafts/${read.id}/send`, { expected: asRead(read) })
    expect(refused.status).toBe(409)
    expect(refused.json.error.message).toBe('This draft changed; read it again.')
    expect((await ana.api('GET', `/notes/${read.id}`)).json.status).toBe('draft')
  })

  it('refuses a draft that differed when it was read for sending, even if it is put back before the send', async () => {
    const read = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'see you at 3' }))
      .json
    await anaAgent.api('PATCH', `/drafts/${read.id}`, { body: 'wire the money now' })
    const putBack = meanwhile(server, /^UPDATE notes SET status = 'sent'/, [
      sql`UPDATE notes SET body = ${read.body} WHERE id = ${read.id}`,
    ])
    const refused = await putBack.request('POST', `/api/v1/drafts/${read.id}/send`, {
      cookie: ana.cookie,
      body: { expected: asRead(read) },
    })
    expect(refused.status).toBe(409)
    expect((await ana.api('GET', `/notes/${read.id}`)).json.status).toBe('draft')
    expect((await ben.api('GET', `/notes/${read.id}`)).status).toBe(404)
  })

  it('refuses a draft that was in another room when it was read for sending, even if it is moved back', async () => {
    for (const slug of ['billing', 'support']) await ana.api('POST', '/channels', { slug, description: slug })
    await ben.api('PUT', '/channels/support/membership', { answering: true })
    const read = (await anaAgent.api('POST', '/drafts', { channel: 'billing', body: 'our numbers' })).json
    await anaAgent.api('PATCH', `/drafts/${read.id}`, { channel: 'support' })
    const movedBack = meanwhile(server, /^UPDATE notes SET status = 'sent'/, [
      sql`UPDATE notes SET conversation_id = ${read.conversationId} WHERE id = ${read.id}`,
    ])
    const refused = await movedBack.request('POST', `/api/v1/drafts/${read.id}/send`, {
      cookie: ana.cookie,
      body: { expected: asRead(read) },
    })
    expect(refused.status).toBe(409)
    expect(await storedRows(server, 'receipts')).toEqual([])
    expect((await ben.api('GET', '/events/poll?after=0')).json.events).not.toContainEqual(
      expect.objectContaining({ body: expect.objectContaining({ type: 'note.sent' }) }),
    )
  })

  it('refuses a draft that changes after it was read for sending and before it is sent', async () => {
    const read = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'see you at 3' }))
      .json
    const late = meanwhile(server, /^UPDATE notes SET status = 'sent'/, [
      sql`UPDATE notes SET body = ${'wire the money now'} WHERE id = ${read.id}`,
    ])
    const refused = await late.request('POST', `/api/v1/drafts/${read.id}/send`, {
      cookie: ana.cookie,
      body: { expected: asRead(read) },
    })
    expect([refused.status, refused.json.error.message]).toEqual([409, DRAFT_CHANGED])
    expect(await storedRows(server, 'receipts')).toEqual([])
  })

  it('says a draft was already sent when another send wins between reading it and sending it', async () => {
    const read = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'once' })).json
    const raced = meanwhile(server, /^UPDATE notes SET status = 'sent'/, [
      sql`UPDATE notes SET status = 'sent' WHERE id = ${read.id}`,
    ])
    const refused = await raced.request('POST', `/api/v1/drafts/${read.id}/send`, {
      cookie: ana.cookie,
      body: { expected: asRead(read) },
    })
    expect([refused.status, refused.json.error.message]).toEqual([
      409,
      'This draft was already sent or discarded.',
    ])
  })

  it('counts a change of case alone as a change, on every database', async () => {
    const read = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'do not ship' })).json
    await anaAgent.api('PATCH', `/drafts/${read.id}`, { body: 'DO NOT SHIP' })
    expect((await ana.api('POST', `/drafts/${read.id}/send`, { expected: asRead(read) })).status).toBe(409)
  })

  it('refuses an edited send whose starting text an agent changed meanwhile', async () => {
    const read = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'draft one' })).json
    await anaAgent.api('PATCH', `/drafts/${read.id}`, { body: 'draft two' })
    const refused = await ana.api('POST', `/drafts/${read.id}/send`, { body: 'mine', expected: asRead(read) })
    expect(refused.status).toBe(409)
    expect((await ana.api('GET', `/notes/${read.id}`)).json.body).toBe('draft two')
  })

  it('sends the draft as read, or as edited from what was read', async () => {
    const read = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'as read' })).json
    const sent = (await ana.api('POST', `/drafts/${read.id}/send`, { expected: asRead(read) })).json
    expect(sent).toMatchObject({ status: 'sent', body: 'as read', origin: 'agent' })
    const other = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'start' })).json
    const edited = await ana.api('POST', `/drafts/${other.id}/send`, {
      body: 'finish',
      expected: asRead(other),
    })
    expect(edited.json).toMatchObject({ status: 'sent', body: 'finish', origin: 'human_edited' })
  })

  it('still says a draft was already sent when the person reads and sends it twice', async () => {
    const read = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'once' })).json
    await ana.api('POST', `/drafts/${read.id}/send`, { expected: asRead(read) })
    const again = await ana.api('POST', `/drafts/${read.id}/send`, { expected: asRead(read) })
    expect(again.status).toBe(409)
    expect(again.json.error.message).toBe('This draft was already sent or discarded.')
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
    await ben.api('POST', `/drafts/${b.id}/send`, await asShown(ben, b.id))
    expect((await ben.api('GET', `/notes/${a.id}`)).json.status).toBe('discarded')
    expect((await ben.api('GET', '/drafts')).json.drafts).toEqual([])
    const thread = (await ana.api('GET', `/conversations/${note.conversationId}/notes`)).json.notes
    expect(thread.map((entry: any) => entry.body)).toEqual(['question', 'answer B'])
  })
})
