import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DRAFT_REQUEST_LIFETIME_MS } from '../src/domain/draft-requests.ts'
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
let anaSecondAgent: Agent
let benAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
  anaSecondAgent = await connectAgent(server, ana, { name: 'Ana second agent' })
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
})

afterEach(() => server.close())

const receivedByAna = async (body: string) => {
  const draft = (await ben.api('POST', '/drafts', { to: [ana.me.member.id], body })).json
  return (await ben.api('POST', `/drafts/${draft.id}/send`, await asShown(ben, draft.id))).json
}

const waitingFor = async (who: Session | Agent) =>
  (await who.api('GET', '/draft-requests')).json.requests.map((request: any) => request.id)

describe('asking for a draft', () => {
  it('records what the person wants and where the draft should go', async () => {
    const note = await receivedByAna('Is the migration safe?')
    const reply = (
      await ana.api('POST', '/draft-requests', { inReplyTo: note.id, instruction: 'Say yes, briefly.' })
    ).json
    await server.clock.advance(1)
    const fresh = (await ana.api('POST', '/draft-requests', { to: [ben.me.member.id] })).json
    expect(reply).toMatchObject({
      conversationId: note.conversationId,
      inReplyTo: note.id,
      instruction: 'Say yes, briefly.',
      agentId: null,
      cancelledAt: null,
      draftIds: [],
    })
    expect(reply.expiresAt - reply.createdAt).toBe(DRAFT_REQUEST_LIFETIME_MS)
    expect(fresh).toMatchObject({ conversationId: note.conversationId, inReplyTo: null, instruction: '' })
    expect(await waitingFor(ana)).toEqual([reply.id, fresh.id])
  })

  it('refuses a destination the person could not write to themselves', async () => {
    const hidden = (await ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'not sent yet' })).json
    expect((await ana.api('POST', '/draft-requests', {})).status).toBe(400)
    expect((await ana.api('POST', '/draft-requests', { inReplyTo: hidden.id })).status).toBe(404)
    expect((await ana.api('POST', '/draft-requests', { to: ['mem_doesnotexist00'] })).status).toBe(404)
    expect(
      (await ana.api('POST', '/draft-requests', { to: [ben.me.member.id], instruction: 'x'.repeat(2001) }))
        .status,
    ).toBe(400)
    await ben.api('PUT', `/blocks/${ana.me.member.id}`)
    expect((await ana.api('POST', '/draft-requests', { to: [ben.me.member.id] })).status).toBe(403)
  })

  it('is a person’s decision: an agent can neither ask nor withdraw', async () => {
    const request = (await ana.api('POST', '/draft-requests', { to: [ben.me.member.id] })).json
    expect((await anaAgent.api('POST', '/draft-requests', { to: [ben.me.member.id] })).status).toBe(403)
    expect((await anaAgent.api('POST', `/draft-requests/${request.id}/cancel`)).status).toBe(403)
  })

  it('tells only the requester’s own clients', async () => {
    const before = (await ben.api('GET', '/events/poll')).json.cursor
    const request = (
      await ana.api('POST', '/draft-requests', { to: [ben.me.member.id], instruction: 'private wish' })
    ).json
    const mine = (await anaAgent.api('GET', '/events/poll')).json.events
    expect(mine.at(-1).body).toEqual({ type: 'draft.requested', request })
    expect((await ben.api('GET', `/events/poll?after=${before}`)).json.events).toEqual([])
    expect(await waitingFor(ben)).toEqual([])
    expect(await waitingFor(benAgent)).toEqual([])
    expect((await ben.api('POST', `/draft-requests/${request.id}/cancel`)).status).toBe(404)
    expect((await benAgent.api('POST', '/drafts', { requestId: request.id, body: 'hijack' })).status).toBe(
      404,
    )
  })

  it('caps the number of requests waiting at once', async () => {
    for (let index = 0; index < 50; index++) {
      if (index % 25 === 0) await server.clock.advance(60_000)
      expect((await ana.api('POST', '/draft-requests', { to: [ben.me.member.id] })).status).toBe(200)
    }
    await server.clock.advance(60_000)
    expect((await ana.api('POST', '/draft-requests', { to: [ben.me.member.id] })).status).toBe(409)
  })
})

describe('answering a draft request', () => {
  it('puts the draft where the request points and links it to the request', async () => {
    const note = await receivedByAna('Is the migration safe?')
    const request = (await ana.api('POST', '/draft-requests', { inReplyTo: note.id })).json
    const draft = (await anaAgent.api('POST', '/drafts', { requestId: request.id, body: 'Yes.' })).json
    expect(draft).toMatchObject({
      status: 'draft',
      inReplyTo: note.id,
      conversationId: note.conversationId,
      origin: 'agent',
      agentName: 'Ana agent',
    })
    const events = (await ana.api('GET', '/events/poll')).json.events.map((event: any) => event.body)
    expect(events.at(-1)).toMatchObject({
      type: 'draft.request.changed',
      request: { id: request.id, draftIds: [draft.id] },
    })
    expect((await ben.api('GET', `/notes/${draft.id}`)).status).toBe(404)
  })

  it('lets every connected agent answer once and the person choose', async () => {
    const request = (await ana.api('POST', '/draft-requests', { to: [ben.me.member.id] })).json
    const first = (await anaAgent.api('POST', '/drafts', { requestId: request.id, body: 'first take' })).json
    await server.clock.advance(1)
    expect(await waitingFor(anaAgent)).toEqual([])
    expect(await waitingFor(anaSecondAgent)).toEqual([request.id])
    const second = (
      await anaSecondAgent.api('POST', '/drafts', { requestId: request.id, body: 'second take' })
    ).json
    expect((await ana.api('GET', '/draft-requests')).json.requests[0].draftIds).toEqual([first.id, second.id])
  })

  it('stops asking the other agents once the person has sent one answer', async () => {
    const request = (await ana.api('POST', '/draft-requests', { to: [ben.me.member.id] })).json
    const draft = (await anaAgent.api('POST', '/drafts', { requestId: request.id, body: 'good enough' })).json
    await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))
    expect(await waitingFor(anaSecondAgent)).toEqual([])
  })

  it('reaches only the agent the person chose', async () => {
    const chosen = (await ana.api('GET', '/credentials')).json.credentials.find(
      (each: any) => each.name === 'Ana second agent',
    )
    const request = (await ana.api('POST', '/draft-requests', { to: [ben.me.member.id], agentId: chosen.id }))
      .json
    expect(request.agentId).toBe(chosen.id)
    expect(await waitingFor(anaAgent)).toEqual([])
    expect(await waitingFor(anaSecondAgent)).toEqual([request.id])
    expect(
      (await anaAgent.api('POST', '/drafts', { requestId: request.id, body: 'not for me' })).status,
    ).toBe(409)
    expect(
      (await anaSecondAgent.api('POST', '/drafts', { requestId: request.id, body: 'for me' })).status,
    ).toBe(200)
  })

  it('refuses to address another member’s agent, a person’s session, or a revoked agent', async () => {
    const credentials = (await ana.api('GET', '/credentials')).json.credentials
    const benCredentials = (await ben.api('GET', '/credentials')).json.credentials
    const own = credentials.find((each: any) => each.name === 'Ana agent')
    const ask = (agentId: string) => ana.api('POST', '/draft-requests', { to: [ben.me.member.id], agentId })
    expect((await ask(benCredentials.find((each: any) => each.kind === 'agent').id)).status).toBe(404)
    expect((await ask(credentials.find((each: any) => each.kind === 'human').id)).status).toBe(404)
    await ana.api('DELETE', `/credentials/${own.id}`)
    expect((await ask(own.id)).status).toBe(404)
  })

  it('stops waiting when withdrawn or after a day', async () => {
    const withdrawn = (await ana.api('POST', '/draft-requests', { to: [ben.me.member.id] })).json
    const stale = (await ana.api('POST', '/draft-requests', { to: [ben.me.member.id] })).json
    const cancelled = (await ana.api('POST', `/draft-requests/${withdrawn.id}/cancel`)).json
    expect(cancelled.cancelledAt).toBeGreaterThan(0)
    expect((await ana.api('POST', `/draft-requests/${withdrawn.id}/cancel`)).status).toBe(409)
    expect((await anaAgent.api('POST', '/drafts', { requestId: withdrawn.id, body: 'late' })).status).toBe(
      409,
    )
    expect(await waitingFor(anaAgent)).toEqual([stale.id])
    await server.clock.advance(DRAFT_REQUEST_LIFETIME_MS)
    expect(await waitingFor(anaAgent)).toEqual([])
    expect(await waitingFor(ana)).toEqual([])
    expect((await anaAgent.api('POST', '/drafts', { requestId: stale.id, body: 'late' })).status).toBe(409)
    expect((await ana.api('POST', '/draft-requests/dreq_doesnotexist00/cancel')).status).toBe(404)
    expect((await ana.api('POST', '/draft-requests/nonsense/cancel')).status).toBe(400)
  })
})
