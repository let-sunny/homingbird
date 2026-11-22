import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { DEBATE_PACING } from '../src/sql/migrations/debate-pacing-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the debate pacing step', () => {
  it('is the fifteenth step, after sources and reasons', () => {
    expect(stepNumberOf(DEBATE_PACING)).toBe(15)
  })

  it('adds whether a total follows the agents, and the turn an agent read, leaving rooms before it fixed', async () => {
    const earlier = MIGRATIONS.indexOf(DEBATE_PACING)
    database = await migratedThrough(earlier)
    expect(await database.columnsOf('debates')).not.toContain('total_follows_agents')
    expect(await database.columnsOf('debate_turns')).not.toContain('after_turn')
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), DEBATE_PACING])).toEqual([earlier + 1])
    expect(await database.columnsOf('debates')).toContain('total_follows_agents')
    expect(await database.columnsOf('debate_turns')).toContain('after_turn')
  })

  it('adds only columns that may be empty, so every room and turn before it reads as before', () => {
    for (const step of DEBATE_PACING) expect('addTo' in step && step.column.nullable).toBe(true)
  })
})
