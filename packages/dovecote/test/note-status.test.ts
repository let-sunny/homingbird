import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { announceStatus, noteById } from '../src/domain/note-status.ts'
import { transact } from '../src/events/events.ts'
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

const statusEvents = async (session: Session) =>
  (await session.api('GET', '/events/poll?after=0')).json.events
    .map((event: any) => event.body)
    .filter((body: any) => body.type === 'note.status')

describe('the status of a note', () => {
  it('is announced with its receipts to every participant once the note is sent', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Lunch?' })).json
    await ana.api('POST', `/drafts/${draft.id}/send`, await asShown(ana, draft.id))
    await T.runPromise(transact(announceStatus(draft.id)), server.env)
    for (const session of [ana, ben])
      expect((await statusEvents(session)).at(-1)).toMatchObject({
        noteId: draft.id,
        conversationId: draft.conversationId,
        receipts: [expect.objectContaining({ memberId: ben.me.member.id, state: 'delivered' })],
      })
  })

  it('is not announced for a draft, which nobody else may know of', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Lunch?' })).json
    await T.runPromise(transact(announceStatus(draft.id)), server.env)
    expect(await statusEvents(ana)).toEqual([])
    expect(await statusEvents(ben)).toEqual([])
  })

  it('reads a note as a given viewer, or as nobody in particular', async () => {
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Lunch?' })).json
    const asAuthor = await T.runPromise(transact(noteById(draft.id, ana.me.member.id)), server.env)
    const asNobody = await T.runPromise(transact(noteById(draft.id, null)), server.env)
    expect(asAuthor).toMatchObject({ id: draft.id, body: 'Lunch?', status: 'draft' })
    expect(asNobody.id).toBe(draft.id)
  })
})
