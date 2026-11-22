import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { DISCARDED_BY } from '../src/sql/migrations/discarded-by-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the discarded by step', () => {
  it('is the last step', () => {
    expect(stepNumberOf(DISCARDED_BY)).toBe(MIGRATIONS.length)
  })

  it('adds who discarded a note to every note, empty for the notes before it', async () => {
    const earlier = MIGRATIONS.indexOf(DISCARDED_BY)
    database = await migratedThrough(earlier)
    await database.execute(
      `INSERT INTO members (id, email, subject, name, profile, role, status, event_seq, created_at) VALUES ('mem_ana', 'ana@example.com', 'dev:ana', 'Ana', '', 'member', 'active', 0, 1)`,
    )
    await database.execute(
      `INSERT INTO conversations (id, kind, title, created_at, last_activity_at) VALUES ('conv_room00000000', 'group', null, 1, 1)`,
    )
    await database.execute(
      `INSERT INTO notes (id, conversation_id, author_id, status, body, origin, created_at, updated_at) VALUES ('note_kept00000000', 'conv_room00000000', 'mem_ana', 'discarded', 'Kept', 'agent', 1, 1)`,
    )
    expect(await database.columnsOf('notes')).not.toContain('discarded_by')
    expect(await database.migrate(MIGRATIONS)).toEqual([earlier + 1])
    expect(await database.columnsOf('notes')).toContain('discarded_by')
    expect(
      await database.execute(`UPDATE notes SET discarded_by = 'mem_ana' WHERE id = 'note_kept00000000'`),
    ).toBe(1)
  })

  it('adds only a column that may be empty', () => {
    for (const step of DISCARDED_BY) expect('addTo' in step && step.column.nullable).toBe(true)
  })
})
