import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PICKUP_GRACE_MS } from '../src/domain/note-rows.ts'
import {
  type Agent,
  type Session,
  type TestServer,
  asShown,
  connectAgent,
  startTestServer,
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

describe('a note as its viewer sees it', () => {
  it('shows what a draft was based on to its author only', async () => {
    const draft = (
      await anaAgent.api('POST', '/drafts', {
        to: [ben.me.member.id],
        body: 'Tuesday.',
        basis: 'the calendar',
      })
    ).json
    expect(draft.basis).toBe('the calendar')
    await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))
    expect((await ana.api('GET', `/notes/${draft.id}`)).json.basis).toBe('the calendar')
    const seenByBen = (await ben.api('GET', `/notes/${draft.id}`)).json
    expect(seenByBen).not.toHaveProperty('basis')
  })

  it('has no receipts while a draft, and one per recipient once sent', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Hi' })).json
    expect(draft.receipts).toEqual([])
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).json
    expect(sent.receipts).toEqual([
      expect.objectContaining({ memberId: ben.me.member.id, state: 'delivered' }),
    ])
  })

  it('shows drafting from the first reply draft on, and from a pickup only for the grace period', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Hi' })).json
    await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))
    await benAgent.api('POST', `/notes/${draft.id}/pickup`)
    const receipt = async () => (await ana.api('GET', `/notes/${draft.id}`)).json.receipts[0]
    expect((await receipt()).state).toBe('drafting')
    await server.clock.advance(PICKUP_GRACE_MS)
    expect((await receipt()).state).toBe('delivered')
    const reply = (await benAgent.api('POST', '/drafts', { inReplyTo: draft.id, body: 'Hello' })).json
    await server.clock.advance(PICKUP_GRACE_MS)
    expect(await receipt()).toMatchObject({ state: 'drafting', draftingAt: reply.createdAt })
  })
})
