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

afterEach(() => server?.close())

const send = async (author: Session, to: Session, body: string) => {
  const draft = (await author.api('POST', '/drafts', { to: [to.me.member.id], body })).json
  return (await author.api('POST', `/drafts/${draft.id}/send`, await asShown(author, draft.id))).json
}

describe('the inbox', () => {
  it('gives the inbox everything an agent needs to quote a note', async () => {
    const note = await send(ana, ben, 'question')
    const [item] = (await benAgent.api('GET', '/inbox')).json.items
    expect(item.note.id).toBe(note.id)
    expect(item.author).toMatchObject({ name: 'Ana', email: 'ana@example.com' })
    expect(item.conversation).toMatchObject({ id: note.conversationId, kind: 'direct', unreadCount: 1 })
    expect((await anaAgent.api('GET', '/inbox')).json.items).toEqual([])
  })
})

describe('fresh notes', () => {
  const fresh = async (agent: Agent) =>
    (await agent.api('GET', '/inbox?fresh=1')).json.items.map(
      (item: { note: { id: string } }) => item.note.id,
    )

  it('shows an agent only the notes it has not picked up yet when it asks for fresh ones', async () => {
    const note = await send(ana, ben, 'question')
    expect(await fresh(benAgent)).toEqual([note.id])
    await benAgent.api('POST', `/notes/${note.id}/pickup`)
    expect(await fresh(benAgent)).toEqual([])
    expect((await benAgent.api('GET', '/inbox')).json.items).toHaveLength(1)
  })

  it('hands a note one desk of a person picked up to none of their other desks within the grace', async () => {
    const note = await send(ana, ben, 'question')
    const second = await connectAgent(server, ben, { name: 'Ben second agent' })
    await benAgent.api('POST', `/notes/${note.id}/pickup`)
    expect(await fresh(second)).toEqual([])
    expect((await second.api('GET', '/inbox')).json.items).toHaveLength(1)
    await server.clock.advance(PICKUP_GRACE_MS)
    expect(await fresh(second)).toEqual([note.id])
    expect(await fresh(benAgent)).toEqual([])
  })

  it('never hands another desk of the person a note one of them drafted a reply to or skipped', async () => {
    const drafted = await send(ana, ben, 'first')
    const skipped = await send(ana, ben, 'second')
    const second = await connectAgent(server, ben, { name: 'Ben second agent' })
    await benAgent.api('POST', `/notes/${drafted.id}/pickup`)
    await benAgent.api('POST', '/drafts', {
      conversationId: drafted.conversationId,
      inReplyTo: drafted.id,
      body: 'yes',
    })
    await benAgent.api('POST', `/notes/${skipped.id}/pickup`)
    await benAgent.api('POST', `/notes/${skipped.id}/release`, { reason: 'not mine to answer' })
    await server.clock.advance(PICKUP_GRACE_MS)
    expect(await fresh(second)).toEqual([])
    expect(await fresh(benAgent)).toEqual([])
    expect(await fresh(anaAgent)).toEqual([])
    expect((await second.api('GET', '/inbox')).json.items).toHaveLength(2)
  })
})
