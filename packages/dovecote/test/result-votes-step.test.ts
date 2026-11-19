import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { RESULT_VOTES } from '../src/sql/migrations/result-votes-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(() => database?.close())

describe('the result votes step', () => {
  it('adds the vote to rooms that already exist, and the tables for drafts and votes', async () => {
    const step = stepNumberOf(RESULT_VOTES)
    database = await migratedThrough(step - 1)
    expect(await database.columnsOf('debates')).not.toContain('votes_open_at')
    expect(await database.migrate(MIGRATIONS.slice(0, step))).toEqual([step])
    expect(await database.columnsOf('debates')).toEqual(
      expect.arrayContaining(['votes_open_at', 'grace_minutes', 'dropped_out']),
    )
    expect(await database.columnsOf('debate_drafts')).not.toEqual([])
    expect(await database.columnsOf('debate_votes')).not.toEqual([])
  })
})
