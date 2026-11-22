import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { askersOf, reviewersOf } from '../src/domain/reviews.ts'
import { wantsPushAbout } from '../src/push/wants-push.ts'
import { run } from '../src/sql/database.ts'
import { insertInto, sql } from '../src/sql/query.ts'
import { type Session, type TestServer, asShown, startTestServer, storedRows } from './harness.ts'

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
    await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))
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
    await ana.api('POST', `/drafts/${toBen.id}/send`, await asShown(ana, toBen.id))
    await server.clock.advance(1_000)
    const toCy = (await ana.api('POST', '/drafts', { to: [cy.me.member.id], body: 'to cy' })).json
    await ana.api('POST', `/drafts/${toCy.id}/send`, await asShown(ana, toCy.id))
    const list = (await ana.api('GET', '/conversations')).json.conversations
    expect(list.map((conversation: any) => conversation.id)).toEqual([
      toCy.conversationId,
      toBen.conversationId,
    ])
  })
})

describe('group conversations', () => {
  it('creates a group that every participant can read once its first note is sent', async () => {
    const group = (
      await ana.api('POST', '/conversations', {
        participantIds: [ben.me.member.id, cy.me.member.id],
        title: 'Launch',
      })
    ).json
    expect(group).toMatchObject({ kind: 'group', title: 'Launch', lastNote: null })
    expect(group.participantIds).toHaveLength(3)

    const draft = (await ana.api('POST', '/drafts', { conversationId: group.id, body: 'to everyone' })).json
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).json
    expect(sent.receipts.map((receipt: any) => receipt.memberId).sort()).toEqual(
      [ben.me.member.id, cy.me.member.id].sort(),
    )
    await ben.api('POST', `/notes/${sent.id}/read`)
    const forCy = (await cy.api('GET', `/notes/${sent.id}`)).json.receipts
    expect(forCy.filter((receipt: any) => receipt.state === 'read')).toHaveLength(1)
    expect(forCy).toEqual((await ana.api('GET', `/notes/${sent.id}`)).json.receipts)
    const reply = (await cy.api('POST', '/drafts', { conversationId: group.id, body: 'got it' })).json
    expect(reply.conversationId).toBe(group.id)
  })

  it('hides a new group from everyone but its starter until a note in it is sent', async () => {
    const group = await startGroup()
    expect(await sightings(ana, group.id, STARTER)).toEqual(SEEN_EMPTY)
    for (const other of [ben, cy]) expect(await sightings(other, group.id)).toEqual(UNSEEN)

    const draft = (await ana.api('POST', '/drafts', { conversationId: group.id, body: 'quokka plan' })).json
    for (const other of [ben, cy]) {
      expect(await sightings(other, group.id)).toEqual(UNSEEN)
      expect((await other.api('POST', '/drafts', { conversationId: group.id, body: 'me too' })).status).toBe(
        404,
      )
    }

    await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))
    for (const other of [ben, cy])
      expect(await sightings(other, group.id)).toEqual({
        listed: true,
        byId: 200,
        unread: 1,
        events: true,
        found: 1,
      })
    expect(await sightings(ana, group.id, STARTER)).toEqual({
      listed: true,
      byId: 200,
      unread: 0,
      events: true,
      found: 1,
    })
  })

  it('hides a group again from the others when its only draft is discarded, and keeps it for its starter', async () => {
    const group = await startGroup()
    const draft = (await ana.api('POST', '/drafts', { conversationId: group.id, body: 'quokka plan' })).json
    await ana.api('POST', `/drafts/${draft.id}/discard`)
    for (const other of [ben, cy]) expect(await sightings(other, group.id)).toEqual(UNSEEN)
    expect(await sightings(ana, group.id, STARTER)).toEqual(SEEN_EMPTY)
    const again = (await ana.api('POST', '/drafts', { conversationId: group.id, body: 'second try' })).json
    expect(again.conversationId).toBe(group.id)
  })

  it('gives another member who starts a group with the same people a room of their own', async () => {
    const anas = await startGroup()
    const draft = (await ana.api('POST', '/drafts', { conversationId: anas.id, body: 'quokka plan' })).json
    const bens = (
      await ben.api('POST', '/conversations', { participantIds: [ana.me.member.id, cy.me.member.id] })
    ).json
    expect(bens.id).not.toBe(anas.id)
    expect(await sightings(ben, anas.id)).toEqual(UNSEEN)
    expect(await sightings(ana, bens.id)).toEqual(UNSEEN)
    await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))
    expect((await sightings(ben, anas.id)).listed).toBe(true)
  })

  it('shows a group started before its starter was recorded to no one until a note in it is sent', async () => {
    const group = await startGroup()
    await T.runPromise(run(sql`UPDATE conversations SET asked_by = NULL WHERE id = ${group.id}`), server.env)
    for (const member of [ana, ben, cy]) expect(await sightings(member, group.id)).toEqual(UNSEEN)
    const created = await T.runPromise(
      run(
        insertInto('notes', {
          id: 'note_legacy',
          conversation_id: group.id,
          author_id: ana.me.member.id,
          status: 'sent',
          body: 'quokka plan',
          origin: 'human',
          created_at: 1,
          updated_at: 1,
          sent_at: 1,
        }),
      ),
      server.env,
    )
    expect(created).toBe(1)
    for (const member of [ana, ben, cy]) expect((await sightings(member, group.id)).listed).toBe(true)
  })

  it('treats a group starter as no asker: no reviewers, and pushes as a group', async () => {
    const group = await startGroup()
    const draft = (await ana.api('POST', '/drafts', { conversationId: group.id, body: 'quokka plan' })).json
    const [row] = (await storedRows(server, 'notes')).filter((note) => note.id === draft.id)
    expect(await T.runPromise(reviewersOf(row as never), server.env)).toEqual([])
    expect(
      await T.runPromise(askersOf({ conversation_id: group.id as never, in_reply_to: null }), server.env),
    ).toEqual([])
    await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))
    for (const member of [ana, ben]) {
      await member.api('PUT', '/me/notifications', { notifications: 'direct' })
      expect(await T.runPromise(wantsPushAbout(member.me.member.id, group.id as never), server.env)).toBe(
        true,
      )
    }
  })

  it('never names a group’s starter, and names no managers outside a channel', async () => {
    const group = await startGroup()
    const seen = (await ana.api('GET', `/conversations/${group.id}`)).json
    expect(seen).not.toHaveProperty('askedBy')
    expect(seen).not.toHaveProperty('managerIds')
  })

  it('names who manages a channel in its room, among the people in it', async () => {
    const made = (await ana.api('POST', '/channels', { slug: 'billing', description: 'Billing' })).json
    await ben.api('PUT', '/channels/billing/membership', {})
    const room = (await ben.api('GET', `/conversations/${made.conversationId}`)).json
    expect(room.managerIds).toEqual([ana.me.member.id])
    expect(room).not.toHaveProperty('askedBy')
    expect((await cy.api('GET', `/conversations/${made.conversationId}`)).status).toBe(404)
  })

  it('keeps a direct conversation readable by id from both sides, as before', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'quokka plan' })).json
    expect((await ben.api('GET', '/conversations')).json.conversations).toEqual([])
    expect((await ben.api('GET', `/conversations/${draft.conversationId}`)).status).toBe(200)
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

const STARTER = { ignoringOwnDrafts: true }
const UNSEEN = { listed: false, byId: 404, unread: 0, events: false, found: 0 }
const SEEN_EMPTY = { listed: true, byId: 200, unread: 0, events: false, found: 0 }

const startGroup = async (): Promise<{ id: string }> =>
  (await ana.api('POST', '/conversations', { participantIds: [ben.me.member.id, cy.me.member.id] })).json

/** Every way a member could come across the group; its starter's own draft events are left out. */
const sightings = async (who: Session, groupId: string, options = { ignoringOwnDrafts: false }) => {
  const list = (await who.api('GET', '/conversations')).json.conversations
  const events = (await who.api('GET', '/events/poll?after=0')).json.events
  return {
    listed: list.some((conversation: any) => conversation.id === groupId),
    byId: (await who.api('GET', `/conversations/${groupId}`)).status,
    unread: list.reduce((total: number, conversation: any) => total + conversation.unreadCount, 0),
    events: events.some(
      (event: any) =>
        !(options.ignoringOwnDrafts && event.body.type.startsWith('draft.')) &&
        JSON.stringify(event).includes(groupId),
    ),
    found: (await who.api('GET', '/search?q=quokka')).json.notes.filter(
      (note: any) => note.conversationId === groupId,
    ).length,
  }
}
