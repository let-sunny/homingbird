import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { placeOf, placeOfConversation } from '../src/domain/places.ts'
import { type Session, type TestServer, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
})

afterEach(() => server?.close())

const placeOfRoom = (id: string) => T.runPromise(placeOfConversation(id as never), server.env)

describe('placeOfConversation', () => {
  it('names a channel, keeps an archived channel’s name, and groups direct messages as null', async () => {
    await ana.api('POST', '/channels', { slug: 'billing', description: 'Billing' })
    const room = (await ana.api('GET', '/channels/billing')).json.conversationId
    const direct = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'hi' })).json
      .conversationId
    expect(await placeOfRoom(room)).toBe('billing')
    expect(await placeOfRoom(direct)).toBeNull()
    await ana.api('POST', '/admin/channels/billing/archive', {})
    expect(await placeOfRoom(room)).toBe('billing')
    expect(await placeOfRoom('conv_doesnotexist000')).toBeNull()
  })

  it('treats a group that was never a channel as a direct message', () => {
    expect(
      placeOf({ place_kind: 'group', place_title: 'Lunch', place_archived_at: null, place_slug: null }),
    ).toBeNull()
  })
})
