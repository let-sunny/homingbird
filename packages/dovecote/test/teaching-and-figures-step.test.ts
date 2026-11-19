import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { TEACHING_AND_FIGURES } from '../src/sql/migrations/teaching-and-figures-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(() => database?.close())

describe('the teaching and figures step', () => {
  it('adds what an agent draft needs for the figures to a note that already exists, leaving it as it was', async () => {
    const step = stepNumberOf(TEACHING_AND_FIGURES)
    database = await migratedThrough(step - 1)
    await database.execute(
      "INSERT INTO notes (id, conversation_id, author_id, status, body, in_reply_to, origin, agent_name, credential_id, created_at, updated_at, sent_at, basis) VALUES ('n1', 'c1', 'm1', 'sent', 'hello', NULL, 'agent', 'Agent', 'k1', 1, 1, 1, NULL)",
    )
    expect(await database.migrate(MIGRATIONS.slice(0, step))).toEqual([step])
    expect(await database.columnsOf('notes')).toEqual(
      expect.arrayContaining(['seen_at', 'decided_at', 'agent_body', 'agent_client', 'agent_model']),
    )
    expect(await database.indexesOf('notes')).toEqual(
      expect.arrayContaining(['notes_status_sent_at_idx', 'notes_decided_at_idx']),
    )
    expect(await database.execute("UPDATE notes SET decided_at = 2 WHERE id = 'n1' AND body = 'hello'")).toBe(
      1,
    )
  })

  it('creates principles, their applications and offers, and the record of skipped notes', async () => {
    database = await migratedThrough(stepNumberOf(TEACHING_AND_FIGURES))
    for (const table of [
      'principles',
      'principle_applications',
      'principle_offers',
      'principle_quiet_places',
      'releases',
    ])
      expect(await database.columnsOf(table)).not.toEqual([])
  })
})
