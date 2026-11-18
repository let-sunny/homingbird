import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { abandonDraftsIn } from '../src/domain/abandoned-drafts.ts'
import type { Delivery } from '../src/events/events.ts'
import { type Session, type TestServer, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  await ana.api('POST', '/channels', { slug: 'billing', description: 'Invoices' })
  await ben.api('PUT', '/channels/billing/membership', {})
})

afterEach(() => server.close())

describe('abandonDraftsIn', () => {
  it('discards one author’s waiting drafts in one room, tells that author, and leaves everything else', async () => {
    const leaving = (await ben.api('POST', '/drafts', { channel: 'billing', body: 'Half a thought' })).json
    const elsewhere = (await ben.api('POST', '/drafts', { to: [ana.me.member.id], body: 'Kept' })).json
    const others = (await ana.api('POST', '/drafts', { channel: 'billing', body: 'Also kept' })).json
    const outbox: Delivery[] = []
    await T.runPromise(
      T.provide({ outbox, audited: [] })(abandonDraftsIn(leaving.conversationId, ben.me.member.id)),
      server.env,
    )
    expect((await ben.api('GET', '/drafts')).json.drafts.map((draft: any) => draft.id)).toEqual([
      elsewhere.id,
    ])
    expect((await ana.api('GET', `/notes/${others.id}`)).json.status).toBe('draft')
    expect(outbox.map((delivery) => [delivery.memberId, delivery.event.body])).toEqual([
      [
        ben.me.member.id,
        { type: 'draft.discarded', noteId: leaving.id, conversationId: leaving.conversationId },
      ],
    ])
  })
})
