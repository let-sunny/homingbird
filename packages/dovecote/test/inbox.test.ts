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
