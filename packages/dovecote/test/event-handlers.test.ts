import { Task as T } from '@homingbird/kernel'
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

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
})

afterEach(() => server?.close())

describe('the event handlers', () => {
  it('poll for events after a cursor, never waiting longer than the protocol allows', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Hi' })).json
    await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))
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

  it('let a running desk say its agent cannot answer, tell its person once, and show colleagues only until when', async () => {
    const pushed: string[] = []
    ;(server.env as { pushDeskUnavailable: unknown }).pushDeskUnavailable = (_: unknown, kind: string) =>
      T.sync(() => void pushed.push(kind))
    const desk = new AbortController()
    server.env.hub.subscribe(ana.me.member.id, 'agent', desk.signal)
    const said = await anaAgent.api('POST', '/me/desk/unavailable', { kind: 'usage_limit', until: 5_000 })
    expect(said.json).toEqual({})
    await anaAgent.api('POST', '/me/desk/unavailable', { kind: 'usage_limit', until: 9_000 })
    expect(pushed).toEqual(['usage_limit'])
    const seenBy = async (viewer: Session) =>
      (await viewer.api('GET', '/directory')).json.entries.find(
        (entry: any) => entry.member.id === ana.me.member.id,
      ).presence
    expect(await seenBy(ben)).toEqual({
      humanOnline: false,
      agentOnline: true,
      agentUnavailable: { until: 9_000 },
    })
    expect((await seenBy(ana)).agentUnavailable).toEqual({ until: 9_000, kind: 'usage_limit' })
    await anaAgent.api('POST', '/me/desk/available', {})
    expect((await seenBy(ben)).agentUnavailable).toBeUndefined()
    desk.abort()
  })

  it('refuse a kind of unavailability the server does not know', async () => {
    expect((await anaAgent.api('POST', '/me/desk/unavailable', { kind: 'bored' })).status).toBe(400)
  })

  it('give out the public push key, the same every time', async () => {
    const first = (await ana.api('GET', '/push/key')).json.publicKey
    expect(first).toMatch(/^[A-Za-z0-9_-]{80,}$/)
    expect((await ben.api('GET', '/push/key')).json.publicKey).toBe(first)
  })
})
