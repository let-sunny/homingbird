import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let anaAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
})

afterEach(() => server.close())

describe('the event handlers', () => {
  it('poll for events after a cursor, never waiting longer than the protocol allows', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Hi' })).json
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    const all = (await ben.api('GET', '/events/poll?after=0')).json
    expect(all.events.map((event: any) => event.body.type)).toContain('note.sent')
    expect((await ben.api('GET', `/events/poll?after=${all.cursor}`)).json.events).toEqual([])
  })

  it('count a page as looked at until it says otherwise, so no push is needed meanwhile', async () => {
    expect(
      (await ana.api('POST', '/presence/visibility', { page: 'inbox-page', visible: true })).json,
    ).toEqual({})
    expect(server.env.hub.isLooking(ana.me.member.id)).toBe(true)
    await ana.api('POST', '/presence/visibility', { page: 'inbox-page', visible: false })
    expect(server.env.hub.isLooking(ana.me.member.id)).toBe(false)
    expect((await anaAgent.api('GET', '/presence/heartbeat')).json).toEqual({})
  })

  it('give out the public push key, the same every time', async () => {
    const first = (await ana.api('GET', '/push/key')).json.publicKey
    expect(first).toMatch(/^[A-Za-z0-9_-]{80,}$/)
    expect((await ben.api('GET', '/push/key')).json.publicKey).toBe(first)
  })
})
