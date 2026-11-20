import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { DEBATE_MODEL } from '../src/sql/migrations/debate-model-step.ts'
import { type MigratedDatabase, migratedThrough } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the debate model step', () => {
  it('adds the stated model to the turns, drafts and votes of rooms that already exist', async () => {
    const earlier = MIGRATIONS.includes(DEBATE_MODEL) ? MIGRATIONS.indexOf(DEBATE_MODEL) : MIGRATIONS.length
    database = await migratedThrough(earlier)
    for (const table of ['debate_turns', 'debate_drafts', 'debate_votes'])
      expect(await database.columnsOf(table)).not.toContain('agent_model')
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), DEBATE_MODEL])).toEqual([earlier + 1])
    for (const table of ['debate_turns', 'debate_drafts', 'debate_votes'])
      expect(await database.columnsOf(table)).toContain('agent_model')
  })

  it('adds only columns that may be empty', () => {
    for (const step of DEBATE_MODEL) expect('addTo' in step && step.column.nullable).toBe(true)
  })
})
