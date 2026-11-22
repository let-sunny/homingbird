import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { countUnsentOf, eraseUnsentNotesOf } from '../src/domain/unsent-erasure.ts'
import { transact } from '../src/events/events.ts'
import { run } from '../src/sql/database.ts'
import { insertInto, sql } from '../src/sql/query.ts'
import { type Session, type TestServer, startTestServer, storedRows } from './harness.ts'
import { discardNote, draftNote, sendNote } from './note-support.ts'

let server: TestServer
afterEach(() => server.close())

const notes = async () =>
  (await storedRows(server, 'notes'))
    .map((row) => `${row.author_id === anaId() ? 'ana' : 'ben'} ${row.status}: ${row.body}`)
    .sort()

let ana: Session
let ben: Session
const anaId = () => ana.me.member.id

describe('erasing a person’s unsent notes', () => {
  it('deletes their drafts, discarded notes, draft requests and draft events, and nothing else', async () => {
    server = await startTestServer()
    ana = await server.signIn('ana@example.com')
    ben = await server.signIn('ben@example.com')
    const question = await sendNote(ben, ana, 'Ben asks')
    await sendNote(ana, ben, 'Ana sent this')
    await draftNote(ana, ben, 'Ana never sent this')
    await discardNote(ana, ben, 'Ana threw this away')
    await ana.api('POST', '/drafts', { inReplyTo: question.id, body: 'Ana half answered' })
    await draftNote(ben, ana, 'Ben’s own draft')
    expect((await ana.api('POST', '/draft-requests', { to: [ben.me.member.id] })).status).toBe(200)
    await T.runPromise(
      run(sql`UPDATE receipts SET drafting_at = 5 WHERE note_id = ${question.id} AND member_id = ${anaId()}`),
      server.env,
    )
    await T.runPromise(
      run(
        insertInto('events', { member_id: anaId(), seq: 999, created_at: 1, body: '{"type":"note.sent"}' }),
      ),
      server.env,
    )
    const auditBefore = await storedRows(server, 'audit_events')
    const eventsBefore = await storedRows(server, 'events')
    expect(
      eventsBefore.some(
        (row) => row.member_id === anaId() && String(row.body).includes('Ana never sent this'),
      ),
    ).toBe(true)

    expect(await T.runPromise(countUnsentOf(anaId()), server.env)).toEqual({
      drafts: 2,
      discarded: 1,
      draftRequests: 1,
    })
    expect(await notes()).toHaveLength(6)

    const erased = await T.runPromise(transact(eraseUnsentNotesOf(anaId())), server.env)

    expect(erased).toEqual({ drafts: 2, discarded: 1, draftRequests: 1 })
    expect(await notes()).toEqual([
      'ana sent: Ana sent this',
      'ben draft: Ben’s own draft',
      'ben sent: Ben asks',
    ])
    expect(await storedRows(server, 'draft_requests')).toEqual([])
    const eventsAfter = await storedRows(server, 'events')
    expect(eventsAfter.some((row) => String(row.body).includes('Ana never sent this'))).toBe(false)
    expect(eventsAfter.some((row) => String(row.body).includes('Ana half answered'))).toBe(false)
    expect(eventsAfter.filter((row) => row.member_id !== anaId())).toEqual(
      eventsBefore.filter((row) => row.member_id !== anaId()),
    )
    expect(eventsAfter.some((row) => row.member_id === anaId() && row.seq === 999)).toBe(true)
    expect((await storedRows(server, 'receipts')).every((row) => row.drafting_at === null)).toBe(true)
    expect((await storedRows(server, 'receipts')).length).toBe(2)
    const auditAfter = await storedRows(server, 'audit_events')
    expect(auditAfter.slice(0, auditBefore.length)).toEqual(auditBefore)
    expect(
      auditAfter
        .slice(auditBefore.length)
        .map((row) => [row.event, row.target_id, JSON.parse(String(row.detail))]),
    ).toEqual([['note.unsent_erased', anaId(), { drafts: 2, discarded: 1, draftRequests: 1 }]])
    expect((await ben.api('GET', '/drafts')).json.drafts.map((draft: any) => draft.body)).toEqual([
      'Ben’s own draft',
    ])
    expect((await ana.api('GET', '/drafts')).json.drafts).toEqual([])
  })

  it('counts and erases nothing for a person who has nothing unsent, and still audits the erasure', async () => {
    server = await startTestServer()
    ana = await server.signIn('ana@example.com')
    ben = await server.signIn('ben@example.com')
    await sendNote(ana, ben, 'Sent')
    expect(await T.runPromise(transact(eraseUnsentNotesOf(anaId())), server.env)).toEqual({
      drafts: 0,
      discarded: 0,
      draftRequests: 0,
    })
    expect(await notes()).toEqual(['ana sent: Sent'])
    expect((await storedRows(server, 'audit_events')).at(-1)?.event).toBe('note.unsent_erased')
  })

  it('erases more drafts than one statement deletes', async () => {
    server = await startTestServer()
    ana = await server.signIn('ana@example.com')
    ben = await server.signIn('ben@example.com')
    const { conversationId } = await draftNote(ana, ben, 'First')
    for (let index = 0; index < 510; index++)
      await T.runPromise(
        run(
          insertInto('notes', {
            id: `note_many${String(index).padStart(5, '0')}`,
            conversation_id: conversationId,
            author_id: anaId(),
            status: 'draft',
            body: `Draft ${index}`,
            origin: 'human',
            created_at: 1,
            updated_at: 1,
          }),
        ),
        server.env,
      )
    expect((await T.runPromise(transact(eraseUnsentNotesOf(anaId())), server.env)).drafts).toBe(511)
    expect(await storedRows(server, 'notes')).toEqual([])
  })
})
