import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { exportNotesOf } from '../src/domain/note-export.ts'
import { run } from '../src/sql/database.ts'
import { insertInto, sql } from '../src/sql/query.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'
import { discardNote, draftNote, sendNote } from './note-support.ts'

let server: TestServer
afterEach(() => server.close())

const exported = async (memberId: string) => {
  const lines: string[] = []
  const count = await T.runPromise(
    exportNotesOf(memberId as never, (line) => lines.push(line)),
    server.env,
  )
  return { count, notes: lines.map((line) => JSON.parse(line)) }
}

describe('exporting a person’s notes', () => {
  it('writes every note they wrote, in every status, oldest first, and nobody else’s', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    const ben = await server.signIn('ben@example.com')
    await ana.api('POST', '/channels', { slug: 'billing', description: 'Invoices' })
    const sent = await sendNote(ana, ben, 'Sent to Ben')
    await server.clock.advance(1000)
    await discardNote(ana, ben, 'Thrown away')
    await server.clock.advance(1000)
    await draftNote(ana, ben, 'Still a draft')
    await server.clock.advance(1000)
    await ana.api('POST', '/drafts', { channel: 'billing', body: 'In the channel' })
    await sendNote(ben, ana, 'Ben’s note')
    await T.runPromise(
      run(
        sql`UPDATE notes SET sources = ${'[{"kind":"url","url":"https://example.com"}]'} WHERE id = ${sent.id}`,
      ),
      server.env,
    )

    const { count, notes } = await exported(ana.me.member.id)

    expect(count).toBe(4)
    expect(notes.map((note) => [note.status, note.body, note.conversationKind, note.channel])).toEqual([
      ['sent', 'Sent to Ben', 'direct', null],
      ['discarded', 'Thrown away', 'direct', null],
      ['draft', 'Still a draft', 'direct', null],
      ['draft', 'In the channel', 'channel', 'billing'],
    ])
    expect(notes[0]).toMatchObject({
      id: sent.id,
      conversationId: sent.conversationId,
      authorId: ana.me.member.id,
      origin: 'human',
      sources: [{ kind: 'url', url: 'https://example.com' }],
      createdAt: '2023-11-14T22:13:20.000Z',
      sentAt: expect.stringMatching(/^2023-11-14T/),
    })
    expect(notes[2]).toMatchObject({ sentAt: null, decidedAt: null, sources: null })
    const audit = (await storedRows(server, 'audit_events')).at(-1)!
    expect([audit.event, audit.target_id, JSON.parse(String(audit.detail))]).toEqual([
      'note.exported',
      ana.me.member.id,
      { notes: 4 },
    ])
    expect(String(audit.detail)).not.toContain('Sent to Ben')
  })

  it('pages through a long history, and includes a channel agent’s answer the person approved', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    const ben = await server.signIn('ben@example.com')
    const { conversationId } = await sendNote(ben, ana, 'Ben’s question')
    for (let index = 0; index < 505; index++)
      await T.runPromise(
        run(
          insertInto('notes', {
            id: `note_page${String(index).padStart(5, '0')}`,
            conversation_id: conversationId,
            author_id: index === 0 ? 'mem_channelagent' : ana.me.member.id,
            approved_by: index === 0 ? ana.me.member.id : null,
            status: 'sent',
            body: `Answer ${index}`,
            origin: 'agent',
            created_at: 1_700_000_000_000 + Math.floor(index / 2),
            updated_at: 1,
            sent_at: 1,
          }),
        ),
        server.env,
      )
    const { count, notes } = await exported(ana.me.member.id)
    expect(count).toBe(505)
    expect(new Set(notes.map((note) => note.id)).size).toBe(505)
    expect(notes[0]).toMatchObject({ authorId: 'mem_channelagent', approvedBy: ana.me.member.id })
    expect(notes.at(-1)?.body).toBe('Answer 504')
  })

  it('writes nothing for a person who wrote nothing, and still audits the export', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    expect(await exported(ana.me.member.id)).toEqual({ count: 0, notes: [] })
    expect((await storedRows(server, 'audit_events')).at(-1)?.event).toBe('note.exported')
  })
})
