import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { APPLIED, OFFICE_HOURS, allowAutoSend, directRoom, savedAnswerFor } from './auto-send-support.ts'
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
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
})

afterEach(() => server?.close())

const questionFromBen = async () => {
  const asked = (await benAgent.api('POST', '/drafts', { to: [ana.me.member.id], body: 'When are you in?' }))
    .json
  return (
    await ben.api('POST', `/drafts/${asked.id}/send`, {
      expected: { body: asked.body, conversationId: asked.conversationId },
    })
  ).json
}

describe('delivering a decided draft', () => {
  it('delivers a click and an automatic send the same way: receipts, the room’s activity and the reply settled', async () => {
    await allowAutoSend(ana, true)
    await savedAnswerFor(ana, [await directRoom(ana, ben)])
    const question = await questionFromBen()
    await server.clock.advance(1_000)
    const other = (await anaAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'Let me look.' }))
      .json
    const answer = (
      await anaAgent.api('POST', '/drafts', {
        inReplyTo: question.id,
        body: OFFICE_HOURS.rule,
        basis: APPLIED,
      })
    ).json
    expect(answer.status).toBe('sent')
    expect((await ana.api('GET', `/notes/${other.id}`)).json.status).toBe('discarded')
    expect((await ben.api('GET', `/notes/${question.id}`)).json.receipts[0].repliedAt).toBe(answer.sentAt)
    const [room] = (await storedRows(server, 'conversations')).filter(
      (row) => row.id === answer.conversationId,
    )
    expect(Number(room!.last_activity_at)).toBe(answer.sentAt)
    const receipts = (await storedRows(server, 'receipts')).filter((row) => row.note_id === answer.id)
    expect(receipts.map((row) => row.member_id)).toEqual([ben.me.member.id])
  })

  it('refuses to send a draft its agent changed after the person read it, sending nothing', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Lunch?' })).json
    await anaAgent.api('PATCH', `/drafts/${draft.id}`, { body: 'Dinner?' })
    const refused = await ana.api('POST', `/drafts/${draft.id}/send`, {
      expected: { body: 'Lunch?', conversationId: draft.conversationId },
    })
    expect(refused.status).toBe(409)
    expect((await storedRows(server, 'receipts')).filter((row) => row.note_id === draft.id)).toEqual([])
  })
})
