import { RECALL_WINDOW_MS } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  APPLIED,
  OFFICE_HOURS,
  allowAutoSend,
  directRoom,
  eventsOf,
  savedAnswerFor,
} from './auto-send-support.ts'
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
let anaAgent: Agent
let benAgent: Agent

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'lobby' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
  await allowAutoSend(ana, true)
  await savedAnswerFor(ana, [await directRoom(ana, ben)])
})

afterEach(() => server?.close())

const autoSentToBen = async (inReplyTo?: string) =>
  (
    await anaAgent.api('POST', '/drafts', {
      ...(inReplyTo === undefined ? { to: [ben.me.member.id] } : { inReplyTo }),
      body: OFFICE_HOURS.rule,
      basis: APPLIED,
    })
  ).json

describe('recalling an automatically sent note', () => {
  it('withdraws it from the recipient everywhere and tells their stream, keeping it marked for the author', async () => {
    const sent = await autoSentToBen()
    const recalled = (await ana.api('POST', `/notes/${sent.id}/recall`)).json
    expect(recalled).toMatchObject({ status: 'withdrawn', autoSent: true, receipts: [] })
    expect((await ben.api('GET', `/notes/${sent.id}`)).status).toBe(404)
    expect(JSON.stringify((await ben.api('GET', '/inbox')).json)).not.toContain(sent.id)
    expect(JSON.stringify((await ben.api('GET', '/search?q=office')).json)).not.toContain(sent.id)
    expect((await ana.api('GET', `/notes/${sent.id}`)).json.status).toBe('withdrawn')
    expect(await storedRows(server, 'receipts')).not.toContainEqual(
      expect.objectContaining({ note_id: sent.id }),
    )
    const withdrawn = (await eventsOf(ben)).filter((event) => event.body.type === 'note.withdrawn')
    expect(withdrawn.map((event) => event.body)).toEqual([
      { type: 'note.withdrawn', noteId: sent.id, conversationId: sent.conversationId },
    ])
    const [entry] = (await storedRows(server, 'audit_events')).filter((row) => row.event === 'note.recalled')
    expect(entry).toMatchObject({ actor_id: ana.me.member.id, target_id: sent.id })
  })

  it('refuses a second recall and a recall once the five minutes have passed', async () => {
    const sent = await autoSentToBen()
    expect((await ana.api('POST', `/notes/${sent.id}/recall`)).status).toBe(200)
    expect((await ana.api('POST', `/notes/${sent.id}/recall`)).status).toBe(409)
    const later = await autoSentToBen()
    await server.clock.advance(RECALL_WINDOW_MS + 1_000)
    expect((await ana.api('POST', `/notes/${later.id}/recall`)).json.error.message).toContain('five minutes')
  })

  it('marks the question it answered as waiting for a reply again', async () => {
    const asked = (
      await benAgent.api('POST', '/drafts', { to: [ana.me.member.id], body: 'When are you in?' })
    ).json
    const question = (
      await ben.api('POST', `/drafts/${asked.id}/send`, {
        expected: { body: asked.body, conversationId: asked.conversationId },
      })
    ).json
    const answer = await autoSentToBen(question.id)
    expect((await ben.api('GET', `/notes/${question.id}`)).json.receipts[0].repliedAt).not.toBeNull()
    await ana.api('POST', `/notes/${answer.id}/recall`)
    expect((await ben.api('GET', `/notes/${question.id}`)).json.receipts[0].repliedAt).toBeNull()
  })

  it('answers not found for a draft and for a note that is not the caller’s', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Not the answer' }))
      .json
    expect((await ana.api('POST', `/notes/${draft.id}/recall`)).status).toBe(404)
    const sent = await autoSentToBen()
    expect((await ben.api('POST', `/notes/${sent.id}/recall`)).status).toBe(404)
  })
})
