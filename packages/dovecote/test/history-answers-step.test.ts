import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { HISTORY_ANSWERS } from '../src/sql/migrations/history-answers-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the answers from history step', () => {
  it('is the thirteenth step', () => {
    expect(stepNumberOf(HISTORY_ANSWERS)).toBe(13)
  })

  it('adds a table of questions answered from history, one row per person, room and answer', async () => {
    const earlier = MIGRATIONS.indexOf(HISTORY_ANSWERS)
    database = await migratedThrough(earlier)
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), HISTORY_ANSWERS])).toEqual([earlier + 1])
    expect(await database.columnsOf('history_answers')).toEqual(
      expect.arrayContaining(['member_id', 'conversation_id', 'note_id', 'answered_at']),
    )
    const insert = (at: number) =>
      database!.execute(
        `INSERT INTO history_answers (member_id, conversation_id, note_id, answered_at) VALUES ('mem_a', 'conv_a', 'note_a', ${at})`,
      )
    expect(await insert(1)).toBe(1)
    await expect(insert(2)).rejects.toThrow()
  })
})
