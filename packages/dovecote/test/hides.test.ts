import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asRead } from './channel-agent-support.ts'
import { type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let cy: Session

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'general' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
})

afterEach(() => server.close())

const send = async (from: Session, where: { to: string[] } | { conversationId: string }, body: string) => {
  const draft = (await from.api('POST', '/drafts', { ...where, body })).json
  return (await from.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).json
}

const listedIds = async (person: Session): Promise<string[]> =>
  (await person.api('GET', '/conversations')).json.conversations.map((room: { id: string }) => room.id)

const LATER_MS = 1_000

describe('hiding a conversation', () => {
  it('takes it out of the person’s own list only, and says so on the room itself', async () => {
    const note = await send(ana, { to: [ben.me.member.id] }, 'Lunch?')
    await server.clock.advance(LATER_MS)
    const hidden = await ben.api('PUT', `/conversations/${note.conversationId}/hidden`)
    expect(hidden.status).toBe(200)
    expect(hidden.json).toMatchObject({ id: note.conversationId, hidden: true, unreadCount: 1 })
    expect(await listedIds(ben)).not.toContain(note.conversationId)
    expect(await listedIds(ana)).toContain(note.conversationId)
    expect((await ben.api('GET', `/conversations/${note.conversationId}`)).json.hidden).toBe(true)
    expect((await ben.api('GET', `/conversations/${note.conversationId}/notes`)).json.notes).toHaveLength(1)
    const shown = await ben.api('DELETE', `/conversations/${note.conversationId}/hidden`)
    expect(shown.json).toMatchObject({ hidden: false })
    expect(await listedIds(ben)).toContain(note.conversationId)
  })

  it('brings a hidden room back when a note is sent in it, by anyone', async () => {
    const note = await send(ana, { to: [ben.me.member.id] }, 'Lunch?')
    await server.clock.advance(LATER_MS)
    await ben.api('PUT', `/conversations/${note.conversationId}/hidden`)
    await server.clock.advance(LATER_MS)
    await send(ana, { conversationId: note.conversationId }, 'Tomorrow then?')
    expect(await listedIds(ben)).toContain(note.conversationId)
    expect((await ben.api('GET', `/conversations/${note.conversationId}`)).json.hidden).toBe(false)
  })

  it('keeps a hidden room listed while a draft of the person’s waits there, and hides it once the draft is decided', async () => {
    const note = await send(ana, { to: [ben.me.member.id] }, 'Lunch?')
    const benAgent = await connectAgent(server, ben, { name: 'Ben agent' })
    const waiting = (await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: 'Sure.' })).json
    await server.clock.advance(LATER_MS)
    const hidden = (await ben.api('PUT', `/conversations/${note.conversationId}/hidden`)).json
    expect(hidden).toMatchObject({ hidden: false, draftCount: 1 })
    expect(await listedIds(ben)).toContain(note.conversationId)
    await ben.api('POST', `/drafts/${waiting.id}/discard`, {})
    expect(await listedIds(ben)).not.toContain(note.conversationId)
    await server.clock.advance(LATER_MS)
    await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: 'Sure, at noon.' })
    expect(await listedIds(ben)).toContain(note.conversationId)
  })

  it('stays hidden when someone else’s draft waits there, which the person cannot see', async () => {
    const note = await send(ana, { to: [ben.me.member.id] }, 'Lunch?')
    await server.clock.advance(LATER_MS)
    await ben.api('PUT', `/conversations/${note.conversationId}/hidden`)
    await server.clock.advance(LATER_MS)
    await ana.api('POST', '/drafts', { conversationId: note.conversationId, body: 'Not sent yet' })
    expect(await listedIds(ben)).not.toContain(note.conversationId)
  })

  it('hides a group message as well, and refuses a channel room, whose way out is leaving it', async () => {
    const group = (
      await ana.api('POST', '/conversations', { participantIds: [ben.me.member.id, cy.me.member.id] })
    ).json
    await send(ana, { conversationId: group.id }, 'Planning')
    await server.clock.advance(LATER_MS)
    expect((await cy.api('PUT', `/conversations/${group.id}/hidden`)).json.hidden).toBe(true)
    await cy.api('PUT', '/channels/general/membership', {})
    const room = (await cy.api('GET', '/channels/general')).json.conversationId
    const refused = await cy.api('PUT', `/conversations/${room}/hidden`)
    expect(refused.status).toBe(409)
    expect(await listedIds(cy)).toContain(room)
  })

  it('refuses a room the person is not in as if it did not exist, and an id that is not one', async () => {
    const note = await send(ana, { to: [ben.me.member.id] }, 'Between us')
    expect((await cy.api('PUT', `/conversations/${note.conversationId}/hidden`)).status).toBe(404)
    expect((await cy.api('PUT', '/conversations/not-an-id/hidden')).status).toBe(400)
  })

  it('is a person’s own setting: an agent credential cannot hide, and its list keeps every room', async () => {
    const note = await send(ana, { to: [ben.me.member.id] }, 'Hello')
    const agent = await connectAgent(server, ben, { name: 'Ben agent' })
    expect((await agent.api('PUT', `/conversations/${note.conversationId}/hidden`)).status).toBe(403)
    expect((await agent.api('DELETE', `/conversations/${note.conversationId}/hidden`)).status).toBe(403)
    await server.clock.advance(LATER_MS)
    await ben.api('PUT', `/conversations/${note.conversationId}/hidden`)
    const forAgent = (await agent.api('GET', '/conversations')).json.conversations
    expect(forAgent.map((room: { id: string }) => room.id)).toEqual([note.conversationId])
    expect(forAgent[0]).not.toHaveProperty('hidden')
  })

  it('answers 404 while hiding is off, and lists a room hidden before as it was', async () => {
    const note = await send(ana, { to: [ben.me.member.id] }, 'Hello')
    await server.clock.advance(LATER_MS)
    await ben.api('PUT', `/conversations/${note.conversationId}/hidden`)
    const settings = (await ana.api('GET', '/admin/settings')).json
    await ana.api('PUT', '/admin/settings', {
      ...settings,
      features: { ...settings.features, hideConversations: false },
    })
    expect((await ben.api('DELETE', `/conversations/${note.conversationId}/hidden`)).status).toBe(404)
    expect(await listedIds(ben)).toContain(note.conversationId)
    expect((await ben.api('GET', `/conversations/${note.conversationId}`)).json).not.toHaveProperty('hidden')
  })
})
