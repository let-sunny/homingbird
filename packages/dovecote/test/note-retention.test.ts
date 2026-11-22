import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { purgeExpiredNotes } from '../src/domain/note-retention.ts'
import { housekeepingPass } from '../src/runtime.ts'
import { run } from '../src/sql/database.ts'
import { insertInto } from '../src/sql/query.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'
import { discardNote, draftNote, sendNote } from './note-support.ts'

let server: TestServer
afterEach(() => server.close())

const DAY_MS = 24 * 60 * 60_000

const bodies = async () =>
  (await storedRows(server, 'notes')).map((row) => `${row.status}: ${row.body}`).sort()

const purges = async () =>
  (await storedRows(server, 'audit_events'))
    .filter((row) => row.event === 'note.retention_purged')
    .map((row) => JSON.parse(String(row.detail)))

describe('note retention', () => {
  it('deletes sent and discarded notes older than the retention, and keeps drafts, newer notes and the audit trail', async () => {
    server = await startTestServer({ HB_NOTE_RETENTION_DAYS: '30' })
    const ana = await server.signIn('ana@example.com')
    const ben = await server.signIn('ben@example.com')
    await sendNote(ana, ben, 'Old and sent')
    await discardNote(ana, ben, 'Old and discarded')
    await draftNote(ana, ben, 'Old and still a draft')
    await server.clock.advance(31 * DAY_MS)
    const anaAgain = await server.signIn('ana@example.com')
    const benAgain = await server.signIn('ben@example.com')
    await sendNote(benAgain, anaAgain, 'New and sent')
    await discardNote(benAgain, anaAgain, 'New and discarded')
    const auditBefore = (await storedRows(server, 'audit_events')).length

    await T.runPromise(housekeepingPass, server.env)

    expect(await bodies()).toEqual([
      'discarded: New and discarded',
      'draft: Old and still a draft',
      'sent: New and sent',
    ])
    expect(await purges()).toEqual([{ removed: 2, days: 30 }])
    expect(
      server.logged
        .map((line) => JSON.parse(line))
        .filter((line) => line.eventName === 'housekeeping.notes_purged')
        .map((line) => [line.severityText, line.attributes]),
    ).toEqual([['INFO', { removed: 2, days: 30 }]])
    expect(await storedRows(server, 'audit_events')).toHaveLength(auditBefore + 1)
    expect((await storedRows(server, 'receipts')).length).toBe(1)
    expect((await anaAgain.api('GET', '/drafts')).json.drafts.map((draft: any) => draft.body)).toEqual([
      'Old and still a draft',
    ])
  })

  it('keeps a note until the retention has passed, and writes no audit row when nothing goes', async () => {
    server = await startTestServer({ HB_NOTE_RETENTION_DAYS: '30' })
    const ana = await server.signIn('ana@example.com')
    const ben = await server.signIn('ben@example.com')
    await sendNote(ana, ben, 'Not yet')
    await server.clock.advance(29 * DAY_MS)
    expect(await T.runPromise(purgeExpiredNotes, server.env)).toBe(0)
    expect(await bodies()).toEqual(['sent: Not yet'])
    expect(await purges()).toEqual([])
    expect(server.logged.map((line) => JSON.parse(line).attributes)).toContainEqual({ removed: 0, days: 30 })
  })

  it('keeps every note while no retention is set', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    const ben = await server.signIn('ben@example.com')
    await sendNote(ana, ben, 'Kept')
    await discardNote(ana, ben, 'Also kept')
    await server.clock.advance(4000 * DAY_MS)
    expect(await T.runPromise(purgeExpiredNotes, server.env)).toBe(0)
    expect(await bodies()).toEqual(['discarded: Also kept', 'sent: Kept'])
    expect(server.logged.join('\n')).not.toContain('housekeeping.notes_purged')
  })

  it('deletes a long history in batches, each audited with what it removed', async () => {
    server = await startTestServer({ HB_NOTE_RETENTION_DAYS: '7' })
    const ana = await server.signIn('ana@example.com')
    const ben = await server.signIn('ben@example.com')
    const { conversationId } = await sendNote(ana, ben, 'First')
    const now = server.clock.now()
    for (let index = 0; index < 520; index++)
      await T.runPromise(
        run(
          insertInto('notes', {
            id: `note_old${String(index).padStart(5, '0')}`,
            conversation_id: conversationId,
            author_id: ana.me.member.id,
            status: index < 505 ? 'sent' : 'discarded',
            body: `Old ${index}`,
            origin: 'human',
            created_at: now - 1,
            updated_at: now - 1,
            sent_at: index < 505 ? now - 1 : null,
          }),
        ),
        server.env,
      )
    await server.clock.advance(8 * DAY_MS)
    expect(await T.runPromise(purgeExpiredNotes, server.env)).toBe(521)
    expect(await storedRows(server, 'notes')).toEqual([])
    expect(await purges()).toEqual([
      { removed: 500, days: 7 },
      { removed: 21, days: 7 },
    ])
  })
})
