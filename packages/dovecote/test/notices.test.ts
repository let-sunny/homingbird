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
let benAgent: Agent

beforeEach(async () => {
  server = await startTestServer({ HB_CHANNELS: 'billing' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  benAgent = await connectAgent(server, ben, { name: 'Ben desk' })
})

afterEach(() => server?.close())

const sentToBen = async (body: string) => {
  const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body })).json
  return (await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))).json
}

const noticesOf = async (who: Session, conversationId: string) =>
  (await who.api('GET', `/conversations/${conversationId}/notes`)).json.notices

describe('notices', () => {
  it('keeps why an agent gave a note back, with the latest reason only, until the person asks for a draft', async () => {
    const note = await sentToBen('Is the export done?')
    await benAgent.api('POST', `/notes/${note.id}/release`, { reason: 'No access to the logs.' })
    await benAgent.api('POST', `/notes/${note.id}/release`, {})
    expect(await noticesOf(ben, note.conversationId)).toEqual([
      {
        kind: 'released',
        noteId: note.id,
        conversationId: note.conversationId,
        reason: null,
        agentName: 'Ben desk',
        channel: null,
        at: expect.any(Number),
      },
    ])
    await ben.api('POST', '/draft-requests', { inReplyTo: note.id })
    expect(await noticesOf(ben, note.conversationId)).toEqual([])
  })

  it('returns notices with the newest page only', async () => {
    const note = await sentToBen('Is the export done?')
    await benAgent.api('POST', `/notes/${note.id}/release`, { reason: 'Not mine.' })
    const older = await ben.api(
      'GET',
      `/conversations/${note.conversationId}/notes?before=${note.sentAt + 1}`,
    )
    expect(older.json.notices).toEqual([])
  })
})
