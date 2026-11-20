import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHANNEL, asRead, startAgent, startWithChannel } from './channel-agent-support.ts'
import { type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'general' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
})

afterEach(() => server.close())

const sendTo = async (from: Session, to: Session, body: string) => {
  const draft = (await from.api('POST', '/drafts', { to: [to.me.member.id], body })).json
  return (await from.api('POST', `/drafts/${draft.id}/send`, { expected: asRead(draft) })).json
}

const listed = async (person: Session, conversationId: string) =>
  (await person.api('GET', '/conversations')).json.conversations.find(
    (conversation: { id: string }) => conversation.id === conversationId,
  )

describe('muting a conversation', () => {
  it('keeps delivering and counting unread notes, and says so only to the person who muted it', async () => {
    const first = await sendTo(ana, ben, 'Is the deploy today?')
    const muted = await ben.api('PUT', `/conversations/${first.conversationId}/mute`)
    expect(muted.status).toBe(200)
    expect(muted.json).toMatchObject({ id: first.conversationId, muted: true, unreadCount: 1 })
    await sendTo(ana, ben, 'Or tomorrow?')
    expect(await listed(ben, first.conversationId)).toMatchObject({ muted: true, unreadCount: 2 })
    expect(await listed(ana, first.conversationId)).toMatchObject({ muted: false })
    const unmuted = await ben.api('DELETE', `/conversations/${first.conversationId}/mute`)
    expect(unmuted.json).toMatchObject({ muted: false, unreadCount: 2 })
    expect((await ben.api('GET', `/conversations/${first.conversationId}`)).json.muted).toBe(false)
  })

  it('mutes a channel room for one member, and leaving the channel ends the mute', async () => {
    await ana.api('PUT', '/channels/general/membership', {})
    await ben.api('PUT', '/channels/general/membership', {})
    const room = (await ben.api('GET', '/channels/general')).json.conversationId
    await ben.api('PUT', `/conversations/${room}/mute`)
    expect(await listed(ben, room)).toMatchObject({ muted: true })
    expect(await listed(ana, room)).toMatchObject({ muted: false })
    await ben.api('DELETE', '/channels/general/membership')
    await ben.api('PUT', '/channels/general/membership', {})
    expect(await listed(ben, room)).toMatchObject({ muted: false })
  })

  it('refuses a conversation the person does not take part in, as if it did not exist', async () => {
    const cy = await server.signIn('cy@example.com', 'Cy')
    const note = await sendTo(ana, ben, 'Between us')
    const refused = await cy.api('PUT', `/conversations/${note.conversationId}/mute`)
    expect(refused.status).toBe(404)
    expect((await cy.api('PUT', '/conversations/not-an-id/mute')).status).toBe(400)
  })

  it('reveals nothing about a draft waiting for its author: the room stays unlisted and shows no note', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Not sent yet' })).json
    const muted = await ben.api('PUT', `/conversations/${draft.conversationId}/mute`)
    expect(muted.json).toMatchObject({ lastNote: null, unreadCount: 0, draftCount: 0, muted: true })
    expect(JSON.stringify(muted.json)).not.toContain('Not sent yet')
    expect(await listed(ben, draft.conversationId)).toBeUndefined()
  })

  it('is a person’s own setting: an agent credential cannot mute or unmute', async () => {
    const note = await sendTo(ana, ben, 'Hello')
    const agent = await connectAgent(server, ben, { name: 'Ben agent' })
    expect((await agent.api('PUT', `/conversations/${note.conversationId}/mute`)).status).toBe(403)
    expect((await agent.api('DELETE', `/conversations/${note.conversationId}/mute`)).status).toBe(403)
  })

  it('keeps a person’s mutes and level from their agent’s credential, which reads the same rooms without them', async () => {
    const note = await sendTo(ana, ben, 'Hello')
    await ben.api('PUT', `/conversations/${note.conversationId}/mute`)
    await ben.api('PUT', '/me/notifications', { notifications: 'none' })
    const agent = await connectAgent(server, ben, { name: 'Ben agent' })
    expect((await ben.api('GET', '/me')).json).toMatchObject({ notifications: 'none' })
    expect((await agent.api('GET', '/me')).json).not.toHaveProperty('notifications')
    const listedForAgent = (await agent.api('GET', '/conversations')).json.conversations.find(
      (conversation: { id: string }) => conversation.id === note.conversationId,
    )
    expect(listedForAgent).toMatchObject({ id: note.conversationId })
    expect(listedForAgent).not.toHaveProperty('muted')
    expect((await agent.api('GET', `/conversations/${note.conversationId}`)).json).not.toHaveProperty('muted')
    const inbox = (await agent.api('GET', '/inbox')).json.items
    expect(inbox.map((item: { note: { id: string } }) => item.note.id)).toEqual([note.id])
    expect(inbox[0].conversation).not.toHaveProperty('muted')
    expect((await ben.api('GET', '/inbox')).json.items[0].conversation).toMatchObject({ muted: true })
  })

  it('answers 404 while the mute feature is off, and lists conversations without a mute', async () => {
    await server.close()
    server = await startTestServer({ HB_FEATURES: 'mute=off' })
    ana = await server.signIn('ana@example.com', 'Ana')
    ben = await server.signIn('ben@example.com', 'Ben')
    const note = await sendTo(ana, ben, 'Hello')
    expect((await ben.api('PUT', `/conversations/${note.conversationId}/mute`)).status).toBe(404)
    expect(await listed(ben, note.conversationId)).not.toHaveProperty('muted')
  })
})

describe('muting a private question to a channel’s agent', () => {
  it('mutes it for the asker and for each manager on their own, and ends a manager’s mute when they stop managing', async () => {
    await server.close()
    const started = await startWithChannel()
    server = started.server
    const { ana, ben, cy } = started
    await startAgent(server, ana)
    const room: string = (await cy.api('POST', `/channels/${CHANNEL}/private-question`)).json.id
    const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
    await ana.api('PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id, ben.me.member.id] })
    expect((await cy.api('PUT', `/conversations/${room}/mute`)).json).toMatchObject({ muted: true })
    expect((await ben.api('PUT', `/conversations/${room}/mute`)).json).toMatchObject({ muted: true })
    expect((await ana.api('GET', `/conversations/${room}`)).json).toMatchObject({ muted: false })
    await ana.api('PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id] })
    expect((await ben.api('PUT', `/conversations/${room}/mute`)).status).toBe(404)
    await ana.api('PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id, ben.me.member.id] })
    expect((await ben.api('GET', `/conversations/${room}`)).json).toMatchObject({ muted: false })
    expect((await cy.api('GET', `/conversations/${room}`)).json).toMatchObject({ muted: true })
  })
})
