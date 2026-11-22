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

afterEach(() => server?.close())

const send = async (author: Session, to: Session, body: string) => {
  const draft = (await author.api('POST', '/drafts', { to: [to.me.member.id], body })).json
  return (await author.api('POST', `/drafts/${draft.id}/send`, await asShown(author, draft.id))).json
}

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
})
