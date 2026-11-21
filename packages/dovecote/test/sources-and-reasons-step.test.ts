import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { SOURCES_AND_REASONS } from '../src/sql/migrations/sources-and-reasons-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the sources and reasons step', () => {
  it('is the last step', () => {
    expect(stepNumberOf(SOURCES_AND_REASONS)).toBe(MIGRATIONS.length)
  })

  it('adds a draft’s sources and a discard’s reason to every note, keeping the notes', async () => {
    const earlier = MIGRATIONS.indexOf(SOURCES_AND_REASONS)
    database = await migratedThrough(earlier)
    await database.execute(
      `INSERT INTO members (id, email, subject, name, profile, role, status, event_seq, created_at) VALUES ('mem_ana', 'ana@example.com', 'dev:ana', 'Ana', '', 'member', 'active', 0, 1)`,
    )
    await database.execute(
      `INSERT INTO conversations (id, kind, title, created_at, last_activity_at) VALUES ('conv_room00000000', 'group', null, 1, 1)`,
    )
    await database.execute(
      `INSERT INTO notes (id, conversation_id, author_id, status, body, origin, created_at, updated_at) VALUES ('note_kept00000000', 'conv_room00000000', 'mem_ana', 'draft', 'Kept', 'agent', 1, 1)`,
    )
    expect(await database.columnsOf('notes')).not.toContain('sources')
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), SOURCES_AND_REASONS])).toEqual([
      earlier + 1,
    ])
    expect(await database.columnsOf('notes')).toEqual(expect.arrayContaining(['sources', 'discard_reason']))
    expect(
      await database.execute(
        `UPDATE notes SET sources = '[]', discard_reason = 'Out of date' WHERE id = 'note_kept00000000'`,
      ),
    ).toBe(1)
  })

  it('adds only columns that may be empty', () => {
    for (const step of SOURCES_AND_REASONS) expect('addTo' in step && step.column.nullable).toBe(true)
  })
})
