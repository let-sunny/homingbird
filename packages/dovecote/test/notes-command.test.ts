import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { runNotesCommand } from '../src/notes-command.ts'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import { type TestServer, startTestServer, storedRows } from './harness.ts'
import { discardNote, draftNote, sendNote } from './note-support.ts'

let server: TestServer
afterEach(() => server.close())

const command = async (...args: string[]) => {
  const lines: string[] = []
  const code = await T.runPromise(
    runNotesCommand(args, (line) => lines.push(line)),
    server.env,
  )
  return { code, lines }
}

const USAGE =
  'Usage: dovecote notes export <email> | dovecote notes delete-drafts <email> [--yes] | dovecote notes retention --dry-run [--days N]'

const DAY_MS = 24 * 60 * 60_000

describe('dovecote notes', () => {
  it('exports one person’s notes as JSON lines', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    const ben = await server.signIn('ben@example.com')
    await sendNote(ana, ben, 'Sent')
    await server.clock.advance(1000)
    await draftNote(ana, ben, 'Draft')
    await sendNote(ben, ana, 'Not Ana’s')
    const exported = await command('export', 'ANA@example.com')
    expect(exported.code).toBe(0)
    expect(exported.lines.map((line) => JSON.parse(line).body)).toEqual(['Sent', 'Draft'])
  })

  it('says what deleting drafts would delete, and deletes nothing without --yes', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    const ben = await server.signIn('ben@example.com')
    await draftNote(ana, ben, 'Draft')
    await discardNote(ana, ben, 'Discarded')
    await discardNote(ana, ben, 'Discarded too')
    const before = await storedRows(server, 'notes')
    expect(await command('delete-drafts', 'ana@example.com')).toEqual({
      code: 0,
      lines: [
        'Would delete 1 draft, 2 discarded notes and 0 draft requests of ana@example.com.',
        'Nothing was deleted. This cannot be undone: run it again with --yes to delete them.',
      ],
    })
    expect(await storedRows(server, 'notes')).toEqual(before)
  })

  it('deletes one person’s unsent notes with --yes, and keeps their sent notes', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com')
    const ben = await server.signIn('ben@example.com')
    await sendNote(ana, ben, 'Sent')
    await draftNote(ana, ben, 'Draft one')
    await draftNote(ana, ben, 'Draft two')
    expect(await command('delete-drafts', 'ana@example.com', '--yes')).toEqual({
      code: 0,
      lines: [
        'Deleted 2 drafts, 0 discarded notes and 0 draft requests of ana@example.com. Their sent notes and the audit trail are kept.',
      ],
    })
    expect((await storedRows(server, 'notes')).map((row) => row.body)).toEqual(['Sent'])
  })

  it('says nobody has an unknown email, and how to call it otherwise', async () => {
    server = await startTestServer()
    expect(await command('export', 'nobody@example.com')).toEqual({
      code: 1,
      lines: ['No person has the email nobody@example.com.'],
    })
    for (const args of [
      [],
      ['export'],
      ['export', 'a@example.com', '--yes'],
      ['delete-drafts'],
      ['delete-drafts', 'a@example.com', '--force'],
      ['delete-drafts', 'a@example.com', '--yes', '--yes'],
      ['erase', 'a@example.com'],
      ['retention'],
      ['retention', '--days', '30'],
      ['retention', '--dry-run', '--days'],
      ['retention', '--dry-run', '--days', 'thirty'],
      ['retention', '--dry-run', '--days', '30', '--yes'],
    ])
      expect(await command(...args)).toEqual({ code: 2, lines: [USAGE] })
  })

  it('previews what note retention would delete, counting sent and discarded notes apart, and deletes nothing', async () => {
    server = await startTestServer({ HB_NOTE_RETENTION_DAYS: '30' })
    const ana = await server.signIn('ana@example.com')
    const ben = await server.signIn('ben@example.com')
    await sendNote(ana, ben, 'Old and sent')
    await discardNote(ana, ben, 'Old and discarded')
    await draftNote(ana, ben, 'Old and still a draft')
    await server.clock.advance(31 * DAY_MS)
    const anaAgain = await server.signIn('ana@example.com')
    await sendNote(anaAgain, await server.signIn('ben@example.com'), 'New and sent')
    const before = await storedRows(server, 'notes')

    expect(await command('retention', '--dry-run')).toEqual({
      code: 0,
      lines: [
        'A retention of 30 days would delete 2 of 4 notes: 1 sent and 1 discarded before 2023-11-15.',
        'The oldest of them was sent on 2023-11-14.',
        'Nothing was deleted. Started with this retention, Dovecote deletes them at once, then hourly.',
      ],
    })
    expect((await command('retention', '--dry-run', '--days', '60')).lines).toEqual([
      'A retention of 60 days would delete 0 of 4 notes: 0 sent and 0 discarded before 2023-10-16.',
      'Nothing was deleted. Started with this retention, Dovecote deletes them at once, then hourly.',
    ])
    expect(await storedRows(server, 'notes')).toEqual(before)
    expect((await storedRows(server, 'audit_events')).map((row) => row.event)).not.toContain(
      'note.retention_purged',
    )
  })

  it('previews a retention only when one is set or given, and of at least a week', async () => {
    server = await startTestServer()
    expect(await command('retention', '--dry-run')).toEqual({
      code: 2,
      lines: [
        'HB_NOTE_RETENTION_DAYS is not set here, so no note is deleted. Pass --days N to preview a retention.',
      ],
    })
    expect(await command('retention', '--dry-run', '--days', '6')).toEqual({
      code: 2,
      lines: ['A note retention must be at least 7 days.'],
    })
    expect((await command('retention', '--dry-run', '--days', '7')).code).toBe(0)
  })

  it('refuses a database of another version without changing it', async () => {
    server = await startTestServer()
    await T.runPromise(run(sql`DELETE FROM schema_versions WHERE version > 1`), server.env)
    expect((await command('export', 'ana@example.com')).code).toBe(3)
  })
})
