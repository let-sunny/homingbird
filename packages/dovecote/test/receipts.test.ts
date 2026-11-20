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

const send = async (author: Session, to: Session, body: string) => {
  const draft = (await author.api('POST', '/drafts', { to: [to.me.member.id], body })).json
  return (await author.api('POST', `/drafts/${draft.id}/send`, await asShown(author, draft.id))).json
}

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
    await ben.api('POST', `/drafts/${reply.id}/send`, await asShown(ben, reply.id))
    await everyoneSees('replied')
  })

  it('does not count an agent pickup as read, and replying implies read', async () => {
    const note = await send(ana, ben, 'question')
    await benAgent.api('POST', `/notes/${note.id}/pickup`)
    const picked = (await ana.api('GET', `/notes/${note.id}`)).json.receipts[0]
    expect(picked).toMatchObject({ state: 'drafting', readAt: null })
    const reply = (await ben.api('POST', '/drafts', { inReplyTo: note.id, body: 'answer' })).json
    await ben.api('POST', `/drafts/${reply.id}/send`, await asShown(ben, reply.id))
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
