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

describe('the note handlers', () => {
  it('answer a draft request when a draft names it, and draft freely when it names none', async () => {
    const request = (
      await ana.api('POST', '/draft-requests', { to: [ben.me.member.id], instruction: 'Say hi' })
    ).json
    const answer = (
      await anaAgent.api('POST', '/drafts', { requestId: request.id, body: 'Hi Ben', model: 'm' })
    ).json
    expect(answer).toMatchObject({ status: 'draft', body: 'Hi Ben', conversationId: request.conversationId })
    expect((await anaAgent.api('GET', '/draft-requests')).json.requests).toEqual([])
    expect((await ana.api('POST', '/draft-requests/not-an-id/cancel', {})).status).toBe(400)
  })

  it('page a conversation backwards from a sent time, and list drafts and the inbox', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'One' })).json
    const sent = (await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).json
    const older = (await ben.api('GET', `/conversations/${sent.conversationId}/notes?before=${sent.sentAt}`))
      .json
    expect(older.notes).toEqual([])
    expect((await ben.api('GET', '/inbox')).json.items).toHaveLength(1)
    expect((await ana.api('GET', '/drafts')).json.drafts).toEqual([])
    expect((await ana.api('GET', `/conversations/${sent.conversationId}`)).json.id).toBe(sent.conversationId)
  })

  it('refuse an id that is not a note id or conversation id before looking anything up', async () => {
    for (const [method, path] of [
      ['GET', '/notes/x'],
      ['POST', '/notes/x/read'],
      ['POST', '/drafts/x/discard'],
      ['GET', '/conversations/x'],
    ] as const)
      expect((await ana.api(method, path, method === 'POST' ? {} : undefined)).status).toBe(400)
  })

  it('answer nothing when a draft is marked as seen', async () => {
    const draft = (await anaAgent.api('POST', '/drafts', { to: [ben.me.member.id], body: 'One' })).json
    expect((await ana.api('POST', `/drafts/${draft.id}/seen`, {})).json).toEqual({})
  })
})
