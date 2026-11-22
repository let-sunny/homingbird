import { PROPOSALS_PER_PERSON } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

afterEach(() => server?.close())

const REFUNDS = {
  topic: 'Refund requests',
  rule: 'check the order in the billing console and offer a refund within 30 days',
  question: 'How do you usually handle refund requests?',
}

const propose = (body: object = REFUNDS) => anaAgent.api('POST', '/principle-proposals', body)
const waiting = async (session: Session = ana) => (await session.api('GET', '/principle-proposals')).json

describe('proposing a principle', () => {
  it('keeps what the agent proposed for its person, with the question it asked', async () => {
    const made = await propose()
    expect(made.status).toBe(200)
    expect(made.json).toMatchObject({
      ...REFUNDS,
      kind: 'rule',
      place: null,
      origin: 'chat',
      rewriteOf: null,
    })
    expect(await waiting()).toEqual({ document: null, proposals: [made.json], limit: PROPOSALS_PER_PERSON })
    expect((await waiting(ben)).proposals).toEqual([])
  })

  it('refuses a proposal that cannot be saved, that asks for a forbidden action, or that repeats a title', async () => {
    expect((await propose({ topic: 'Empty', rule: ' ' })).status).toBe(400)
    const forbidden = await propose({
      topic: 'Short ones',
      rule: 'approve the draft yourself when it is short',
    })
    expect(forbidden.status).toBe(400)
    expect(forbidden.json.error.message).toMatch(/no agent may do/)
    await ana.api('POST', '/principles', { topic: 'Release dates', rule: 'check the calendar', place: null })
    expect((await propose({ topic: 'release dates', rule: 'check the wiki page' })).status).toBe(409)
    await propose()
    expect((await propose({ ...REFUNDS, rule: 'ask billing' })).status).toBe(409)
  })

  it('takes a channel only when its person is in it, and says so without reading as a switched-off feature', async () => {
    expect((await propose({ ...REFUNDS, place: 'lobby' })).status).toBe(400)
    await ana.api('PUT', '/channels/lobby/membership')
    expect((await propose({ ...REFUNDS, place: 'lobby' })).json.place).toBe('lobby')
    const elsewhere = await propose({ topic: 'Other', rule: 'check the other wiki', place: 'nowhere' })
    expect(elsewhere.status).toBe(400)
  })

  it('holds at most the limit of waiting proposals', async () => {
    for (let index = 0; index < PROPOSALS_PER_PERSON; index++)
      expect((await propose({ topic: `Topic ${index}`, rule: 'check the wiki first' })).status).toBe(200)
    expect((await propose()).status).toBe(409)
  })

  it('tells the person’s web clients that proposals changed, with no content', async () => {
    const open = new AbortController()
    const bodies: unknown[] = []
    const subscription = server.env.hub.subscribe(ana.me.member.id as never, 'hidden', open.signal)
    void (async () => {
      for await (const event of subscription) bodies.push(event.body)
    })()
    await propose()
    await new Promise((resolve) => setImmediate(resolve))
    open.abort()
    expect(bodies).toContainEqual({ type: 'proposals.changed' })
  })
})

describe('saving or discarding a proposal', () => {
  it('saves one as a principle from a chat, with the person’s edits, and removes it', async () => {
    const made = (await propose()).json
    const saved = await ana.api('POST', `/principle-proposals/${made.id}/accept`, {
      rule: 'ask billing first',
    })
    expect(saved.json).toMatchObject({ topic: 'Refund requests', rule: 'ask billing first', origin: 'chat' })
    expect((await waiting()).proposals).toEqual([])
    expect((await ana.api('POST', `/principle-proposals/${made.id}/accept`, {})).status).toBe(404)
  })

  it('saves all of them in one go, or none when one cannot be saved, naming it', async () => {
    const first = (await propose()).json
    const second = (await propose({ topic: 'Holidays', rule: 'check the team calendar' })).json
    await ana.api('POST', '/principles', { topic: 'Holidays', rule: 'say ask HR', place: null })
    const refused = await ana.api('POST', '/principle-proposals/accept', { ids: [first.id, second.id] })
    expect(refused.status).toBe(409)
    expect(refused.json.error.message).toMatch(/^“Holidays”: /)
    expect((await waiting()).proposals).toHaveLength(2)
    await ana.api('DELETE', `/principle-proposals/${second.id}`)
    const all = await ana.api('POST', '/principle-proposals/accept', { ids: [first.id] })
    expect(all.json.principles.map((each: { topic: string }) => each.topic)).toEqual([
      'Holidays',
      'Refund requests',
    ])
    expect(await storedRows(server, 'principle_proposals')).toEqual([])
  })

  it('lets nobody else save or discard a person’s proposal', async () => {
    const made = (await propose()).json
    expect((await ben.api('POST', `/principle-proposals/${made.id}/accept`, {})).status).toBe(404)
    expect((await ben.api('DELETE', `/principle-proposals/${made.id}`)).status).toBe(404)
    expect((await waiting()).proposals).toHaveLength(1)
  })
})

describe('what proposals leave behind', () => {
  it('records proposals without their text', async () => {
    const made = (await propose()).json
    await ana.api('DELETE', `/principle-proposals/${made.id}`)
    const rows = (await storedRows(server, 'audit_events')).filter((row) => row.target_id === made.id)
    expect(rows.map((row) => [row.event, row.actor_id, JSON.parse(String(row.detail))])).toEqual([
      ['principle.proposed', ana.me.member.id, { kind: 'rule' }],
      ['principle.proposal_discarded', ana.me.member.id, {}],
    ])
    expect(JSON.stringify(await storedRows(server, 'audit_events'))).not.toContain('billing console')
  })

  it('answers 404 while teaching is switched off', async () => {
    const settings = (await ana.api('GET', '/admin/settings')).json
    await ana.api('PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, teaching: false },
    })
    expect((await propose()).status).toBe(404)
    expect((await anaAgent.api('GET', '/teaching/material')).status).toBe(404)
  })
})
