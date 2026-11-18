import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let cy: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
})

afterEach(() => server.close())

describe('direct conversations', () => {
  it('keeps one conversation per pair, whichever side starts and however many drafts race', async () => {
    const drafts = await Promise.all([
      ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'a1' }),
      ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'b1' }),
      ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'a2' }),
      ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'b2' }),
    ])
    expect(new Set(drafts.map((draft) => draft.json.conversationId)).size).toBe(1)
    expect(await storedRows(server, 'conversations')).toHaveLength(1)
    expect(await storedRows(server, 'participants')).toHaveLength(2)
  })

  it('describes the conversation the same way to both sides, with their own counts', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'hello' })).json
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    await ana.api('POST', '/drafts', { conversationId: draft.conversationId, body: 'second, waiting' })
    const forAna = (await ana.api('GET', `/conversations/${draft.conversationId}`)).json
    const forBen = (await ben.api('GET', `/conversations/${draft.conversationId}`)).json
    expect(forAna).toMatchObject({ kind: 'direct', title: null, unreadCount: 0, draftCount: 1 })
    expect(forBen).toMatchObject({ kind: 'direct', title: null, unreadCount: 1, draftCount: 0 })
    expect(forAna.participantIds.sort()).toEqual([ana.me.member.id, ben.me.member.id].sort())
    expect(forAna.lastNote.body).toBe('hello')
    expect(forBen.lastNote).toEqual(forAna.lastNote)
    await ben.api('POST', `/notes/${draft.id}/read`)
    expect((await ben.api('GET', `/conversations/${draft.conversationId}`)).json.unreadCount).toBe(0)
  })

  it('orders the list by latest activity', async () => {
    const toBen = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'to ben' })).json
    await ana.api('POST', `/drafts/${toBen.id}/send`, {})
    await server.clock.advance(1_000)
    const toCy = (await ana.api('POST', '/drafts', { to: [cy.me.member.id], body: 'to cy' })).json
    await ana.api('POST', `/drafts/${toCy.id}/send`, {})
    const list = (await ana.api('GET', '/conversations')).json.conversations
    expect(list.map((conversation: any) => conversation.id)).toEqual([
      toCy.conversationId,
      toBen.conversationId,
    ])
  })
})

describe('group conversations', () => {
  it('creates a group that every participant sees at once and can draft into', async () => {
    const group = (
      await ana.api('POST', '/conversations', {
        participantIds: [ben.me.member.id, cy.me.member.id],
        title: 'Launch',
      })
    ).json
    expect(group).toMatchObject({ kind: 'group', title: 'Launch', lastNote: null })
    expect(group.participantIds).toHaveLength(3)
    expect((await cy.api('GET', '/conversations')).json.conversations.map((c: any) => c.id)).toEqual([
      group.id,
    ])

    const draft = (await ben.api('POST', '/drafts', { conversationId: group.id, body: 'to everyone' })).json
    const sent = (await ben.api('POST', `/drafts/${draft.id}/send`, {})).json
    expect(sent.receipts.map((receipt: any) => receipt.memberId).sort()).toEqual(
      [ana.me.member.id, cy.me.member.id].sort(),
    )
    await ana.api('POST', `/notes/${sent.id}/read`)
    const forCy = (await cy.api('GET', `/notes/${sent.id}`)).json.receipts
    expect(forCy.filter((receipt: any) => receipt.state === 'read')).toHaveLength(1)
    expect(forCy).toEqual((await ben.api('GET', `/notes/${sent.id}`)).json.receipts)
  })

  it('turns a group of two into the direct conversation and refuses a group of one', async () => {
    const direct = (await ana.api('POST', '/conversations', { participantIds: [ben.me.member.id] })).json
    expect(direct.kind).toBe('direct')
    const again = (
      await ben.api('POST', '/conversations', { participantIds: [ana.me.member.id, ben.me.member.id] })
    ).json
    expect(again.id).toBe(direct.id)
    expect((await ana.api('POST', '/conversations', { participantIds: [ana.me.member.id] })).status).toBe(400)
  })

  it('refuses a group that includes someone the creator may not message', async () => {
    await cy.api('PUT', `/blocks/${ana.me.member.id}`)
    const refused = await ana.api('POST', '/conversations', {
      participantIds: [ben.me.member.id, cy.me.member.id],
    })
    expect(refused.status).toBe(403)
  })
})
