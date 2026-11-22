import { Task as T } from '@homingbird/kernel'
import type { ConversationId } from '@homingbird/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextSendTime } from '../src/domain/send-time.ts'
import { type Session, type TestServer, asShown, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
})

afterEach(() => server?.close())

describe('the time a note is sent at', () => {
  it('is the clock’s time in a conversation with nothing sent yet', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'First' })).json
    expect(await T.runPromise(nextSendTime(draft.conversationId, 1_000), server.env)).toBe(1_000)
  })

  it('comes after the latest sent note, so two notes sent in the same millisecond keep their order', async () => {
    const first = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'First' })).json
    const second = (await ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'Second' })).json
    const sentFirst = (await ana.api('POST', `/drafts/${first.id}/send`, await asShown(ana, first.id))).json
    const sentSecond = (await ben.api('POST', `/drafts/${second.id}/send`, await asShown(ben, second.id)))
      .json
    expect(sentSecond.sentAt).toBe(sentFirst.sentAt + 1)
    const conversationId = first.conversationId as ConversationId
    expect(await T.runPromise(nextSendTime(conversationId, 0), server.env)).toBe(sentSecond.sentAt + 1)
    expect(await T.runPromise(nextSendTime(conversationId, sentSecond.sentAt + 50), server.env)).toBe(
      sentSecond.sentAt + 50,
    )
  })
})
