import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
let cy: Session
let anaAgent: Agent

beforeEach(async () => {
  server = await startTestServer({ HB_FEATURES: 'draftPreviews=on', HB_CHANNELS: 'lobby,ops' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  cy = await server.signIn('cy@example.com', 'Cy')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
})

afterEach(() => server?.close())

const allow = (people: ReadonlyArray<Session>, channels: ReadonlyArray<string> = []) =>
  ana.api('PUT', '/me/draft-previews', { people: people.map((one) => one.me.member.id), channels })

const previewsOf = async (viewer: Session, conversationId: string) =>
  (await viewer.api('GET', `/conversations/${conversationId}/previews`)).json.previews

const sendFromAna = async (destination: Record<string, unknown>, body = 'Sent') => {
  const draft = (await ana.api('POST', '/drafts', { ...destination, body })).json
  return (await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).json
}

const changesTo = (memberId: string) => {
  const open = new AbortController()
  const changes: Array<string | null> = []
  const subscription = server.env.hub.subscribe(memberId as never, 'hidden', open.signal)
  void (async () => {
    for await (const event of subscription)
      if (event.body.type === 'preview.changed') changes.push(event.body.conversationId)
  })()
  return { changes, stop: () => open.abort() }
}

describe('who a person lets see their agent’s drafts', () => {
  it('keeps each person and channel once, and keeps a channel by its room when it is renamed', async () => {
    await ana.api('PUT', '/channels/lobby/membership', {})
    await allow([ben, ben], ['lobby', 'lobby'])
    expect((await ana.api('GET', '/me/draft-previews')).json).toEqual({
      people: [ben.me.member.id],
      channels: ['lobby'],
    })
    await ana.api('PATCH', '/admin/channels/lobby', { slug: 'hall' })
    expect((await ana.api('GET', '/me/draft-previews')).json.channels).toEqual(['hall'])
  })

  it('refuses themself, someone who is not an active person here, and a channel they are not in', async () => {
    expect((await allow([ana])).status).toBe(400)
    expect(
      (await ana.api('PUT', '/me/draft-previews', { people: ['mem_nobodynobody1'], channels: [] })).status,
    ).toBe(400)
    expect((await allow([], ['ops'])).status).toBe(400)
    expect((await allow([], ['missing'])).status).toBe(400)
    await ana.api('PATCH', `/admin/members/${cy.me.member.id}`, { status: 'deactivated' })
    expect((await allow([cy])).status).toBe(400)
  })

  it('tells everyone who gains or loses a view to look again, and nobody else', async () => {
    const toBen = changesTo(ben.me.member.id)
    const toCy = changesTo(cy.me.member.id)
    await allow([ben])
    await allow([])
    await server.clock.flush()
    toBen.stop()
    toCy.stop()
    expect(toBen.changes).toEqual([null, null])
    expect(toCy.changes).toEqual([])
  })
})

describe('an agent’s draft as an allowed viewer sees it', () => {
  it('shows a direct conversation’s draft to the allowed person, follows its edits, and leaves once sent', async () => {
    await allow([ben])
    const sent = await sendFromAna({ to: [ben.me.member.id] })
    const toBen = changesTo(ben.me.member.id)
    const draft = (await anaAgent.api('POST', '/drafts', { inReplyTo: sent.id, body: 'First words' })).json
    expect(await previewsOf(ben, sent.conversationId)).toEqual([
      {
        noteId: draft.id,
        conversationId: sent.conversationId,
        authorId: ana.me.member.id,
        agentName: 'Ana agent',
        inReplyTo: sent.id,
        state: 'unconfirmed',
        body: 'First words',
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      },
    ])
    await anaAgent.api('PATCH', `/drafts/${draft.id}`, { body: 'Better words' })
    expect((await previewsOf(ben, sent.conversationId))[0].body).toBe('Better words')
    await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))
    expect(await previewsOf(ben, sent.conversationId)).toEqual([])
    await server.clock.flush()
    toBen.stop()
    expect(toBen.changes).toEqual([sent.conversationId, sent.conversationId, sent.conversationId])
  })

  it('shows a group conversation’s draft to the allowed people in it only', async () => {
    await allow([ben])
    const group = (
      await ana.api('POST', '/conversations', { participantIds: [ben.me.member.id, cy.me.member.id] })
    ).json
    await sendFromAna({ conversationId: group.id })
    await anaAgent.api('POST', '/drafts', { conversationId: group.id, body: 'For the group' })
    expect((await previewsOf(ben, group.id)).map((one: { body: string }) => one.body)).toEqual([
      'For the group',
    ])
    expect(await previewsOf(cy, group.id)).toEqual([])
    expect(await previewsOf(ana, group.id)).toEqual([])
  })

  it('shows an allowed channel’s draft to everyone in its room, and moves with it to another channel', async () => {
    for (const person of [ana, ben, cy]) await person.api('PUT', '/channels/lobby/membership', {})
    await ana.api('PUT', '/channels/ops/membership', {})
    await ben.api('PUT', '/channels/ops/membership', {})
    await allow([], ['lobby'])
    const draft = (await anaAgent.api('POST', '/drafts', { channel: 'lobby', body: 'Who knows?' })).json
    const lobby = draft.conversationId
    expect(await previewsOf(ben, lobby)).toHaveLength(1)
    expect(await previewsOf(cy, lobby)).toHaveLength(1)
    const toBen = changesTo(ben.me.member.id)
    const moved = (await ana.api('PATCH', `/drafts/${draft.id}`, { channel: 'ops' })).json
    expect(await previewsOf(ben, lobby)).toEqual([])
    expect(await previewsOf(ben, moved.conversationId)).toEqual([])
    await server.clock.flush()
    toBen.stop()
    expect(toBen.changes).toEqual([lobby])
  })

  it('leaves a withdrawn draft’s place without its words, and hides it once the allowance goes', async () => {
    await allow([ben])
    const sent = await sendFromAna({ to: [ben.me.member.id] })
    const draft = (await anaAgent.api('POST', '/drafts', { inReplyTo: sent.id, body: 'Maybe' })).json
    await ana.api('POST', `/drafts/${draft.id}/discard`)
    expect(await previewsOf(ben, sent.conversationId)).toEqual([
      expect.objectContaining({ noteId: draft.id, state: 'withdrawn', body: null }),
    ])
    await allow([])
    expect(await previewsOf(ben, sent.conversationId)).toEqual([])
  })

  it('keeps no withdrawn place for a draft nobody could see', async () => {
    const sent = await sendFromAna({ to: [ben.me.member.id] })
    const draft = (await anaAgent.api('POST', '/drafts', { inReplyTo: sent.id, body: 'Quietly' })).json
    await ana.api('POST', `/drafts/${draft.id}/discard`)
    await allow([ben])
    expect(await previewsOf(ben, sent.conversationId)).toEqual([])
  })
})
