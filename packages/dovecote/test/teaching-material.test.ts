import { PROPOSALS_PER_PERSON } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startAgent, startWithChannel } from './channel-agent-support.ts'
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

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'lobby' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
})

afterEach(() => server.close())

const REFUNDS = {
  topic: 'Refund requests',
  rule: 'check the order in the billing console and offer a refund within 30 days',
  question: 'How do you usually handle refund requests?',
}

const propose = (body: object = REFUNDS) => anaAgent.api('POST', '/principle-proposals', body)
const waiting = async (session: Session = ana) => (await session.api('GET', '/principle-proposals')).json

describe('the material of a teaching chat', () => {
  it('gives the pasted document, the person’s rewritten drafts with the note each answered, and the titles taken', async () => {
    await ana.api('PUT', '/teaching/document', { document: '  Refunds: within 30 days.  ' })
    const question = (
      await ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'Can I get a refund?' })
    ).json
    await ben.api('POST', `/drafts/${question.id}/send`, {
      expected: { body: question.body, conversationId: question.conversationId },
    })
    const draft = (
      await anaAgent.api('POST', '/drafts', { inReplyTo: question.id, body: 'No refunds, sorry.' })
    ).json
    await ana.api('POST', `/drafts/${draft.id}/send`, {
      body: 'Yes, within 30 days of the order: I will start it now.',
      expected: { body: draft.body, conversationId: draft.conversationId },
    })
    await propose()
    const material = (await anaAgent.api('GET', '/teaching/material')).json
    expect(material).toMatchObject({
      personName: 'Ana',
      document: 'Refunds: within 30 days.',
      taught: [],
      proposed: ['Refund requests'],
      room: PROPOSALS_PER_PERSON - 1,
    })
    expect(material.rewrites).toEqual([
      expect.objectContaining({
        noteId: draft.id,
        outcome: 'edited',
        draft: 'No refunds, sorry.',
        sent: 'Yes, within 30 days of the order: I will start it now.',
        asked: expect.objectContaining({
          noteId: question.id,
          authorName: 'Ben',
          body: 'Can I get a refund?',
        }),
      }),
    ])
    const fromRewrite = await propose({
      topic: 'Refund windows',
      rule: 'check the order date',
      rewriteOf: draft.id,
    })
    expect(fromRewrite.json.origin).toBe('edit')
    expect((await propose({ topic: 'Other', rule: 'check the wiki', rewriteOf: question.id })).status).toBe(
      400,
    )
    const saved = (await ana.api('POST', `/principle-proposals/${fromRewrite.json.id}/accept`, {})).json
    expect(saved.origin).toBe('edit')
    await ana.api('PUT', '/teaching/document', { document: null })
    expect((await waiting()).document).toBeNull()
  })

  it('refuses a channel’s agent, which its managers teach, and lets it propose nothing', async () => {
    const started = await startWithChannel()
    try {
      const agent = await startAgent(started.server, started.ana)
      expect((await agent.api('GET', '/teaching/material')).status).toBe(403)
      expect(
        (await agent.api('POST', '/principle-proposals', { topic: 'Refunds', rule: 'check' })).status,
      ).toBe(403)
    } finally {
      await started.server.close()
    }
  })
})
