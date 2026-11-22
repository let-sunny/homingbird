import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asRead } from './channel-agent-support.ts'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let cy: Session
let benAgent: Agent

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'general' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
  benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
})

afterEach(() => server.close())

const startGroup = async (): Promise<string> =>
  (await ana.api('POST', '/conversations', { participantIds: [ben.me.member.id, cy.me.member.id] })).json.id

const send = async (from: Session, conversationId: string, body: string) => {
  const draft = (await from.api('POST', '/drafts', { conversationId, body })).json
  return (await from.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).json
}

const eventsOf = async (person: Session | Agent) =>
  (await person.api('GET', '/events/poll?after=0')).json.events.map(
    (event: { body: { type: string } }) => event.body,
  )

describe('leaving a group message', () => {
  it('takes the person out: the others see them gone, and the room keeps its notes for those who stay', async () => {
    const room = await startGroup()
    const asked = await send(ana, room, 'Who has the release notes?')
    expect((await ben.api('POST', `/conversations/${room}/leave`)).status).toBe(200)
    for (const stays of [ana, cy]) {
      const seen = (await stays.api('GET', `/conversations/${room}`)).json
      expect(seen.participantIds).not.toContain(ben.me.member.id)
      expect(seen.participantIds).toHaveLength(2)
      expect((await stays.api('GET', `/notes/${asked.id}`)).status).toBe(200)
      expect(await eventsOf(stays)).toContainEqual({
        type: 'conversation.left',
        conversationId: room,
        memberId: ben.me.member.id,
      })
    }
    expect(await eventsOf(ben)).toContainEqual({
      type: 'conversation.left',
      conversationId: room,
      memberId: ben.me.member.id,
    })
  })

  it('discards the leaver’s own waiting drafts and draft requests there, and keeps the others’ drafts and everything sent', async () => {
    const room = await startGroup()
    const asked = await send(ana, room, 'Who has the release notes?')
    const benDraft = (await benAgent.api('POST', '/drafts', { inReplyTo: asked.id, body: 'I do.' })).json
    const cyAgent = await connectAgent(server, cy, { name: 'Cy agent' })
    const cyDraft = (await cyAgent.api('POST', '/drafts', { inReplyTo: asked.id, body: 'Ben does.' })).json
    const anaDraft = (await ana.api('POST', '/drafts', { conversationId: room, body: 'Thanks both' })).json
    const request = (
      await ben.api('POST', '/draft-requests', { conversationId: room, instruction: 'Say I will look' })
    ).json
    expect((await ben.api('GET', '/draft-requests')).json.requests).toHaveLength(1)
    const benSent = await send(ben, room, 'Looking now.')
    await ben.api('POST', `/conversations/${room}/leave`)
    expect((await ana.api('GET', `/notes/${benDraft.id}`)).status).toBe(404)
    const stored = await ben.api('GET', '/drafts')
    expect(stored.json.drafts.map((draft: { id: string }) => draft.id)).not.toContain(benDraft.id)
    expect((await cy.api('GET', `/notes/${cyDraft.id}`)).json.status).toBe('draft')
    expect((await ana.api('GET', `/notes/${anaDraft.id}`)).json.status).toBe('draft')
    expect(
      (await ben.api('GET', '/draft-requests')).json.requests.map((one: { id: string }) => one.id),
    ).not.toContain(request.id)
    for (const stays of [ana, cy])
      expect((await stays.api('GET', `/notes/${benSent.id}`)).json.status).toBe('sent')
    expect(await eventsOf(ben)).toContainEqual(
      expect.objectContaining({ type: 'draft.discarded', noteId: benDraft.id }),
    )
  })

  it('stops showing the leaver’s agent as drafting a reply to the others', async () => {
    const room = await startGroup()
    const asked = await send(ana, room, 'Who has the release notes?')
    await benAgent.api('POST', `/notes/${asked.id}/pickup`)
    const drafting = (await ana.api('GET', `/notes/${asked.id}`)).json.receipts
    expect(
      drafting.find((receipt: { memberId: string }) => receipt.memberId === ben.me.member.id).draftingAt,
    ).not.toBeNull()
    await ben.api('POST', `/conversations/${room}/leave`)
    const after = (await ana.api('GET', `/notes/${asked.id}`)).json.receipts
    expect(
      after.find((receipt: { memberId: string }) => receipt.memberId === ben.me.member.id)?.draftingAt ??
        null,
    ).toBe(null)
  })

  it('refuses a direct message and a channel room, which are left otherwise, and a room the person is not in', async () => {
    const direct = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Hi' })).json
    await ana.api('POST', `/drafts/${direct.id}/send`, { expected: asRead(direct) })
    expect((await ben.api('POST', `/conversations/${direct.conversationId}/leave`)).status).toBe(409)
    await ben.api('PUT', '/channels/general/membership', {})
    const channelRoom = (await ben.api('GET', '/channels/general')).json.conversationId
    expect((await ben.api('POST', `/conversations/${channelRoom}/leave`)).status).toBe(409)
    expect((await cy.api('POST', `/conversations/${direct.conversationId}/leave`)).status).toBe(404)
  })

  it('tells nobody else about a group no note was sent in yet, when its starter leaves it', async () => {
    const room = await startGroup()
    await ana.api('POST', '/drafts', { conversationId: room, body: 'Draft only' })
    await ana.api('POST', `/conversations/${room}/leave`)
    for (const other of [ben, cy]) expect(JSON.stringify(await eventsOf(other))).not.toContain(room)
    expect((await ana.api('GET', `/conversations/${room}`)).status).toBe(404)
  })

  it('cannot be undone by sending again: the leaver can no longer write there', async () => {
    const room = await startGroup()
    await send(ana, room, 'Hello all')
    await ben.api('POST', `/conversations/${room}/leave`)
    expect((await ben.api('POST', '/drafts', { conversationId: room, body: 'Back' })).status).toBe(404)
    expect((await ben.api('POST', `/conversations/${room}/leave`)).status).toBe(404)
  })

  it('is a person’s own act: an agent credential cannot leave, and the feature switch answers 404', async () => {
    const room = await startGroup()
    await send(ana, room, 'Hello all')
    expect((await benAgent.api('POST', `/conversations/${room}/leave`)).status).toBe(403)
    const settings = (await ana.api('GET', '/admin/settings')).json
    await ana.api('PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, leaveGroups: false },
    })
    expect((await ben.api('POST', `/conversations/${room}/leave`)).status).toBe(404)
    expect((await ben.api('GET', `/conversations/${room}`)).status).toBe(200)
  })
})
