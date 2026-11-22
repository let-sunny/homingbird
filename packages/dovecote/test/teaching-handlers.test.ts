import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let anaAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
})

afterEach(() => server?.close())

describe('the teaching handlers', () => {
  it('give the agent its person’s principles for a draft, and refuse a conversation it is not in', async () => {
    await ana.api('POST', '/principles', { topic: 'Release dates', rule: 'give the weekday', place: null })
    const drafting = (await anaAgent.api('GET', '/principles/drafting')).json
    expect(JSON.stringify(drafting)).toContain('Release dates')
    const theirs = (await ben.api('POST', '/conversations', { participantIds: [ana.me.member.id] })).json
    const cy = await server.signIn('cy@example.com', 'Cy')
    const outside = (await cy.api('POST', '/conversations', { participantIds: [ben.me.member.id] })).json
    expect((await anaAgent.api('GET', `/principles/drafting?conversationId=${theirs.id}`)).status).toBe(200)
    expect((await anaAgent.api('GET', `/principles/drafting?conversationId=${outside.id}`)).status).toBe(400)
  })

  it('dismiss a chance to teach, answering nothing, and give the person their own figures', async () => {
    expect((await ana.api('POST', '/principle-offers/offer_none/dismiss', {})).status).toBe(404)
    const report = (await ana.api('GET', '/insights/me')).json
    expect(report.periods.length).toBeGreaterThan(0)
    expect((await anaAgent.api('GET', '/insights/me')).status).toBe(403)
  })

  it('leave saving a principle to the person', async () => {
    expect(
      (await anaAgent.api('POST', '/principles', { topic: 'Mine', rule: 'agent wrote this', place: null }))
        .status,
    ).toBe(403)
  })
})
