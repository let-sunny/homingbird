import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PICKUP_GRACE_MS } from '../src/domain/note-rows.ts'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

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

const send = async (author: Session, to: Session, body: string) => {
  const draft = (await author.api('POST', '/drafts', { to: [to.me.member.id], body })).json
  return (await author.api('POST', `/drafts/${draft.id}/send`, {})).json
}

describe('drafting', () => {
  it('records who wrote a draft: an agent by name, or the person', async () => {
    const byAgent = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'from agent' }))
      .json
    const byPerson = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'from person' })).json
    expect(byAgent).toMatchObject({
      status: 'draft',
      origin: 'agent',
      agentName: 'Ana agent',
      sentAt: null,
      receipts: [],
    })
    expect(byPerson).toMatchObject({ status: 'draft', origin: 'human', agentName: null })
    expect(byAgent.conversationId).toBe(byPerson.conversationId)
  })

  it('needs exactly one way to address a draft', async () => {
    expect((await ana.api('POST', '/drafts', { body: 'to nobody' })).status).toBe(400)
    expect(
      (await ana.api('POST', '/drafts', { to: [ben.me.member.id, ana.me.member.id], body: 'two' })).status,
    ).toBe(400)
    expect((await ana.api('POST', '/drafts', { to: [ana.me.member.id], body: 'myself' })).status).toBe(403)
    expect((await ana.api('POST', '/drafts', { to: ['mem_doesnotexist00'], body: 'ghost' })).status).toBe(404)
    expect((await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: '   ' })).status).toBe(400)
    expect(
      (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'x'.repeat(16_001) })).status,
    ).toBe(400)
  })

  it('refuses to reply to a draft or to a note the author cannot see', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'first' })).json
    expect((await ana.api('POST', '/drafts', { inReplyTo: draft.id, body: 'reply' })).status).toBe(400)
    expect((await ben.api('POST', '/drafts', { inReplyTo: draft.id, body: 'reply' })).status).toBe(404)
  })

  it('lets the author and the author’s agents edit a draft and tracks mixed authorship', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'v1' })).json
    expect((await anaAgent.api('PATCH', `/drafts/${draft.id}`, { body: 'v2' })).json).toMatchObject({
      body: 'v2',
      origin: 'agent',
    })
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, { body: 'v2' })).json.origin).toBe('agent')
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, { body: 'v3' })).json).toMatchObject({
      body: 'v3',
      origin: 'human_edited',
    })
    expect((await ben.api('PATCH', `/drafts/${draft.id}`, { body: 'hijack' })).status).toBe(404)
    const own = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'mine' })).json
    expect((await anaAgent.api('PATCH', `/drafts/${own.id}`, { body: 'touched' })).json.origin).toBe(
      'human_edited',
    )
  })

  it('caps the number of drafts waiting for approval', async () => {
    for (let index = 0; index < 200; index++) {
      if (index % 100 === 0) await server.clock.advance(60_000)
      expect(
        (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: `draft ${index}` })).status,
      ).toBe(200)
    }
    await server.clock.advance(60_000)
    expect((await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'one too many' })).status).toBe(
      409,
    )
  })
})

describe('approval', () => {
  it('moves a draft to sent exactly once and delivers it to every recipient', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'hello' })).json
    server.clock.advance(5_000)
    await server.clock.flush()
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, {})).json
    expect(sent).toMatchObject({ status: 'sent', origin: 'agent', body: 'hello' })
    expect(sent.sentAt).toBeGreaterThan(sent.createdAt)
    expect(sent.receipts).toEqual([
      {
        memberId: ben.me.member.id,
        state: 'delivered',
        deliveredAt: sent.sentAt,
        readAt: null,
        draftingAt: null,
        repliedAt: null,
      },
    ])
    expect((await ana.api('POST', `/drafts/${draft.id}/send`, {})).status).toBe(409)
    expect((await ana.api('POST', `/drafts/${draft.id}/discard`)).status).toBe(409)
    expect((await ana.api('PATCH', `/drafts/${draft.id}`, { body: 'late edit' })).status).toBe(409)
  })

  it('marks a note the person rewrote before sending as human edited', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'agent words' }))
      .json
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, { body: 'my words' })).json
    expect(sent).toMatchObject({ body: 'my words', origin: 'human_edited', agentName: 'Ana agent' })
    const unchanged = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'same' })).json
    expect((await ana.api('POST', `/drafts/${unchanged.id}/send`, { body: 'same' })).json.origin).toBe(
      'agent',
    )
  })

  it('discards a draft for good', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'never mind' })).json
    expect((await ana.api('POST', `/drafts/${draft.id}/discard`)).json.status).toBe('discarded')
    expect((await ana.api('POST', `/drafts/${draft.id}/send`, {})).status).toBe(409)
    expect((await ana.api('GET', '/drafts')).json.drafts).toEqual([])
    expect((await ana.api('GET', `/notes/${draft.id}`)).json.status).toBe('discarded')
    expect((await ana.api('GET', `/conversations/${draft.conversationId}/notes`)).json.notes).toEqual([])
  })

  it('answers 404 for a draft that does not exist and 400 for a malformed id', async () => {
    expect((await ana.api('POST', '/drafts/note_doesnotexist00/send', {})).status).toBe(404)
    expect((await ana.api('POST', '/drafts/not-an-id/send', {})).status).toBe(400)
  })
})

describe('receipts', () => {
  it('walks delivered, read, drafting and replied, identically for every participant', async () => {
    const note = await send(ana, ben, 'question')
    const seenBy = async (viewer: Session | Agent) =>
      (await viewer.api('GET', `/notes/${note.id}`)).json.receipts
    const everyoneSees = async (state: string) => {
      const views = [await seenBy(ana), await seenBy(ben), await seenBy(anaAgent), await seenBy(benAgent)]
      for (const view of views) expect(view).toEqual(views[0])
      expect(views[0][0].state).toBe(state)
    }
    await everyoneSees('delivered')
    await ben.api('POST', `/notes/${note.id}/read`)
    await everyoneSees('read')
    await benAgent.api('POST', `/notes/${note.id}/pickup`)
    await everyoneSees('drafting')
    const reply = (await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: 'answer' })).json
    await everyoneSees('drafting')
    await ben.api('POST', `/drafts/${reply.id}/send`, {})
    await everyoneSees('replied')
  })

  it('does not count an agent pickup as read, and replying implies read', async () => {
    const note = await send(ana, ben, 'question')
    await benAgent.api('POST', `/notes/${note.id}/pickup`)
    const picked = (await ana.api('GET', `/notes/${note.id}`)).json.receipts[0]
    expect(picked).toMatchObject({ state: 'drafting', readAt: null })
    const reply = (await ben.api('POST', '/drafts', { inReplyTo: note.id, body: 'answer' })).json
    await ben.api('POST', `/drafts/${reply.id}/send`, {})
    const replied = (await ana.api('GET', `/notes/${note.id}`)).json.receipts[0]
    expect(replied.readAt).toBe(replied.repliedAt)
  })

  it('stops showing drafting when a pickup produced no draft within the grace period', async () => {
    const note = await send(ana, ben, 'question')
    await benAgent.api('POST', `/notes/${note.id}/pickup`)
    await server.clock.advance(PICKUP_GRACE_MS - 1)
    expect((await ana.api('GET', `/notes/${note.id}`)).json.receipts[0].state).toBe('drafting')
    await server.clock.advance(1)
    expect((await ana.api('GET', `/notes/${note.id}`)).json.receipts[0].state).toBe('delivered')
  })

  it('falls back from drafting when every reply draft is discarded', async () => {
    const note = await send(ana, ben, 'question')
    const reply = (await ben.api('POST', '/drafts', { inReplyTo: note.id, body: 'answer' })).json
    expect((await ana.api('GET', `/notes/${note.id}`)).json.receipts[0].state).toBe('drafting')
    await ben.api('POST', `/drafts/${reply.id}/discard`)
    expect((await ana.api('GET', `/notes/${note.id}`)).json.receipts[0].state).toBe('delivered')
  })

  it('only lets a recipient’s own person mark a note read, once', async () => {
    const note = await send(ana, ben, 'question')
    const first = (await ben.api('POST', `/notes/${note.id}/read`)).json.receipts[0].readAt
    await server.clock.advance(1_000)
    expect((await ben.api('POST', `/notes/${note.id}/read`)).json.receipts[0].readAt).toBe(first)
    expect((await ana.api('POST', `/notes/${note.id}/read`)).json.receipts[0].readAt).toBe(first)
  })
})

describe('several agents answering one note', () => {
  it('lets each agent draft, and sending one discards the others', async () => {
    const note = await send(ana, ben, 'question')
    const second = await connectAgent(server, ben, { name: 'Ben second agent' })
    const a = (await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: 'answer A' })).json
    const b = (await second.api('POST', '/drafts', { inReplyTo: note.id, body: 'answer B' })).json
    const waiting = (await ben.api('GET', '/drafts')).json.drafts
    expect(waiting.map((draft: any) => [draft.agentName, draft.inReplyTo]).sort()).toEqual([
      ['Ben agent', note.id],
      ['Ben second agent', note.id],
    ])
    await ben.api('POST', `/drafts/${b.id}/send`, {})
    expect((await ben.api('GET', `/notes/${a.id}`)).json.status).toBe('discarded')
    expect((await ben.api('GET', '/drafts')).json.drafts).toEqual([])
    const thread = (await ana.api('GET', `/conversations/${note.conversationId}/notes`)).json.notes
    expect(thread.map((entry: any) => entry.body)).toEqual(['question', 'answer B'])
  })

  it('shows each agent only the notes it has not picked up yet when it asks for fresh ones', async () => {
    const note = await send(ana, ben, 'question')
    const second = await connectAgent(server, ben, { name: 'Ben second agent' })
    expect((await benAgent.api('GET', '/inbox?fresh=1')).json.items).toHaveLength(1)
    await benAgent.api('POST', `/notes/${note.id}/pickup`)
    expect((await benAgent.api('GET', '/inbox?fresh=1')).json.items).toEqual([])
    expect((await benAgent.api('GET', '/inbox')).json.items).toHaveLength(1)
    expect((await second.api('GET', '/inbox?fresh=1')).json.items).toHaveLength(1)
  })
})

describe('reading', () => {
  it('lists a conversation oldest first with the viewer’s drafts last, and pages backwards', async () => {
    for (const body of ['one', 'two', 'three']) {
      await send(ana, ben, body)
      await server.clock.advance(1_000)
    }
    const draft = (await ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'pending' })).json
    const conversationId = draft.conversationId
    const all = (await ben.api('GET', `/conversations/${conversationId}/notes`)).json
    expect(all.notes.map((note: any) => note.body)).toEqual(['one', 'two', 'three', 'pending'])
    expect(all.hasMore).toBe(false)
    const latest = (await ben.api('GET', `/conversations/${conversationId}/notes?limit=2`)).json
    expect(latest.notes.map((note: any) => note.body)).toEqual(['two', 'three', 'pending'])
    expect(latest.hasMore).toBe(true)
    const older = (
      await ben.api('GET', `/conversations/${conversationId}/notes?limit=2&before=${latest.notes[0].sentAt}`)
    ).json
    expect(older.notes.map((note: any) => note.body)).toEqual(['one'])
    expect(older.hasMore).toBe(false)
  })

  it('searches sent notes and own drafts, ignoring case and treating wildcards literally', async () => {
    await send(ana, ben, 'The Migration is 100% done')
    await ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'migration reply draft' })
    expect((await ana.api('GET', '/search?q=MIGRATION')).json.notes).toHaveLength(1)
    expect((await ben.api('GET', '/search?q=migration')).json.notes).toHaveLength(2)
    expect((await ana.api('GET', '/search?q=100%25')).json.notes).toHaveLength(1)
    expect((await ana.api('GET', '/search?q=1_0')).json.notes).toEqual([])
    expect((await ana.api('GET', '/search?q=%25')).json.notes).toHaveLength(1)
    expect((await ana.api('GET', '/search')).status).toBe(400)
  })

  it('gives the inbox everything an agent needs to quote a note', async () => {
    const note = await send(ana, ben, 'question')
    const [item] = (await benAgent.api('GET', '/inbox')).json.items
    expect(item.note.id).toBe(note.id)
    expect(item.author).toMatchObject({ name: 'Ana', email: 'ana@example.com' })
    expect(item.conversation).toMatchObject({ id: note.conversationId, kind: 'dm', unreadCount: 1 })
    expect((await anaAgent.api('GET', '/inbox')).json.items).toEqual([])
  })
})

describe('releasing a picked-up note', () => {
  const stateFor = async (viewer: Session, noteId: string) =>
    (await viewer.api('GET', `/notes/${noteId}`)).json.receipts[0].state

  it('lets the agent give the note back, so the sender sees it read or delivered again, not drafting', async () => {
    const note = await send(ana, ben, 'Can you check the export?')
    await benAgent.api('POST', `/notes/${note.id}/pickup`)
    expect(await stateFor(ana, note.id)).toBe('drafting')
    const released = await benAgent.api('POST', `/notes/${note.id}/release`, {
      reason: 'No basis to answer.',
    })
    expect(released.status).toBe(200)
    expect(released.json.receipts[0].state).toBe('delivered')
    expect(await stateFor(ana, note.id)).toBe('delivered')
    const anaEvents = (await ana.api('GET', '/events/poll?after=0')).json.events.map(
      (event: any) => event.body,
    )
    expect(anaEvents.at(-1)).toMatchObject({ type: 'note.status', noteId: note.id })
    expect(anaEvents.some((body: any) => body.type === 'note.released')).toBe(false)
  })

  it('falls back to read when the person had read it, and takes a release without a reason', async () => {
    const note = await send(ana, ben, 'FYI')
    await ben.api('POST', `/notes/${note.id}/read`)
    await benAgent.api('POST', `/notes/${note.id}/pickup`)
    await benAgent.api('POST', `/notes/${note.id}/release`, {})
    expect(await stateFor(ana, note.id)).toBe('read')
    const released = (await ben.api('GET', '/events/poll?after=0')).json.events
      .map((event: any) => event.body)
      .find((body: any) => body.type === 'note.released')
    expect(released).toMatchObject({ reason: null, agentName: 'Ben agent' })
  })

  it('keeps the pickup, so the same agent is not handed the note again as fresh', async () => {
    const note = await send(ana, ben, 'Fresh once')
    await benAgent.api('POST', `/notes/${note.id}/pickup`)
    await benAgent.api('POST', `/notes/${note.id}/release`, {})
    expect((await benAgent.api('GET', '/inbox?fresh=1')).json.items).toEqual([])
    expect((await benAgent.api('GET', '/inbox')).json.items).toHaveLength(1)
  })

  it('refuses while a reply draft is waiting, and for a note the member cannot see', async () => {
    const note = await send(ana, ben, 'Question')
    await benAgent.api('POST', '/drafts', { inReplyTo: note.id, body: 'Answer' })
    const refused = await benAgent.api('POST', `/notes/${note.id}/release`, {})
    expect([refused.status, refused.json.error.message]).toEqual([
      409,
      'A reply draft to this note is waiting for approval; discard it instead.',
    ])
    expect((await anaAgent.api('POST', '/notes/note_doesnotexist00/release', {})).status).toBe(404)
    expect(
      (await benAgent.api('POST', `/notes/${note.id}/release`, { reason: 'x'.repeat(501) })).status,
    ).toBe(400)
  })
})
