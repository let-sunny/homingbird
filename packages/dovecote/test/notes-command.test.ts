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

const USAGE = 'Usage: dovecote notes export <email> | dovecote notes delete-drafts <email> [--yes]'

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
    ])
      expect(await command(...args)).toEqual({ code: 2, lines: [USAGE] })
  })

  it('refuses a database of another version without changing it', async () => {
    server = await startTestServer()
    await T.runPromise(run(sql`DELETE FROM schema_versions WHERE version > 1`), server.env)
    expect((await command('export', 'ana@example.com')).code).toBe(3)
  })
})
