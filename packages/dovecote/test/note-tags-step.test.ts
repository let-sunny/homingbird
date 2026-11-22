import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { NOTE_TAGS } from '../src/sql/migrations/note-tags-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the note tags step', () => {
  it('is the last step, the twenty-seventh, after the Slack app’s stored values', () => {
    expect(stepNumberOf(NOTE_TAGS)).toBe(MIGRATIONS.length)
    expect(stepNumberOf(NOTE_TAGS)).toBe(27)
  })

  it('adds tags to every note and asking to every receipt, empty for those before it', async () => {
    const earlier = MIGRATIONS.indexOf(NOTE_TAGS)
    database = await migratedThrough(earlier)
    await database.execute(
      `INSERT INTO members (id, email, subject, name, profile, role, status, event_seq, created_at) VALUES ('mem_ana', 'ana@example.com', 'dev:ana', 'Ana', '', 'member', 'active', 0, 1)`,
    )
    await database.execute(
      `INSERT INTO conversations (id, kind, title, created_at, last_activity_at) VALUES ('conv_room00000000', 'group', null, 1, 1)`,
    )
    await database.execute(
      `INSERT INTO notes (id, conversation_id, author_id, status, body, origin, created_at, updated_at) VALUES ('note_kept00000000', 'conv_room00000000', 'mem_ana', 'sent', 'Kept', 'human', 1, 1)`,
    )
    await database.execute(
      `INSERT INTO receipts (note_id, member_id, delivered_at) VALUES ('note_kept00000000', 'mem_ana', 1)`,
    )
    expect(await database.columnsOf('notes')).not.toContain('tags')
    expect(await database.columnsOf('receipts')).not.toContain('asked')
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), NOTE_TAGS])).toEqual([earlier + 1])
    expect(await database.columnsOf('notes')).toContain('tags')
    expect(await database.columnsOf('receipts')).toContain('asked')
    expect(await database.execute(`UPDATE notes SET body = 'Kept' WHERE tags IS NULL`)).toBe(1)
    expect(await database.execute('UPDATE receipts SET read_at = 2 WHERE asked IS NULL')).toBe(1)
  })

  it('adds only columns that may be empty', () => {
    for (const step of NOTE_TAGS) expect('addTo' in step && step.column.nullable).toBe(true)
  })
})
