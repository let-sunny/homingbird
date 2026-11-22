import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteNotes } from '../src/domain/note-deletion.ts'
import { run } from '../src/sql/database.ts'
import { insertInto } from '../src/sql/query.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'
import { sendNote } from './note-support.ts'

let server: TestServer
afterEach(() => server.close())

describe('deleteNotes', () => {
  it('deletes the notes and every row about them, and nothing about another note', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    const ben = await server.signIn('ben@example.com')
    const gone = await sendNote(ana, ben, 'Goes')
    const kept = await sendNote(ana, ben, 'Stays')
    for (const note of [gone, kept]) await aboutNote(server, note.id, note.conversationId, ben.me.member.id)
    const before = await countsAbout(server)
    expect(Object.values(before).every((count) => count === 2)).toBe(true)

    expect(await T.runPromise(deleteNotes([gone.id]), server.env)).toBe(1)

    const after = await countsAbout(server)
    expect(Object.values(after).every((count) => count === 1)).toBe(true)
    expect((await storedRows(server, 'notes')).map((row) => row.body)).toEqual(['Stays'])
    for (const table of TABLES)
      expect((await storedRows(server, table)).map((row) => row.note_id)).toEqual([kept.id])
  })

  it('deletes nothing when given no notes', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    const ben = await server.signIn('ben@example.com')
    await sendNote(ana, ben, 'Stays')
    expect(await T.runPromise(deleteNotes([]), server.env)).toBe(0)
    expect(await storedRows(server, 'notes')).toHaveLength(1)
  })
})

const TABLES = [
  'receipts',
  'pickups',
  'releases',
  'notices',
  'principle_applications',
  'principle_offers',
  'draft_request_answers',
  'history_answers',
] as const

const countsAbout = async (server: TestServer): Promise<Record<string, number>> =>
  Object.fromEntries(
    await Promise.all(
      TABLES.map(async (table) => [table, (await storedRows(server, table)).length] as const),
    ),
  )

/** One row in each table that is about a note, besides the receipt sending already wrote. */
const aboutNote = async (
  server: TestServer,
  noteId: string,
  conversationId: string,
  memberId: string,
): Promise<void> => {
  const rows: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['pickups', { note_id: noteId, credential_id: 'cred_a', picked_at: 1 }],
    [
      'releases',
      {
        note_id: noteId,
        credential_id: 'cred_a',
        member_id: memberId,
        conversation_id: conversationId,
        created_at: 1,
      },
    ],
    [
      'notices',
      { member_id: memberId, note_id: noteId, conversation_id: conversationId, kind: 'k', created_at: 1 },
    ],
    [
      'principle_applications',
      { principle_id: `pr_${noteId}`, note_id: noteId, member_id: memberId, created_at: 1 },
    ],
    [
      'principle_offers',
      {
        id: `po_${noteId}`,
        member_id: memberId,
        note_id: noteId,
        conversation_id: conversationId,
        kind: 'k',
        created_at: 1,
      },
    ],
    ['draft_request_answers', { request_id: `dr_${noteId}`, note_id: noteId, credential_id: 'cred_a' }],
    [
      'history_answers',
      { member_id: memberId, conversation_id: conversationId, note_id: noteId, answered_at: 1 },
    ],
  ]
  for (const [table, row] of rows) await T.runPromise(run(insertInto(table, row)), server.env)
}
