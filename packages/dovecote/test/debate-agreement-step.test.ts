import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { DEBATE_AGREEMENT } from '../src/sql/migrations/debate-agreement-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the debate agreement step', () => {
  it('is the twentieth step, after who discarded an answer', () => {
    expect(stepNumberOf(DEBATE_AGREEMENT)).toBe(20)
  })

  it('adds whether a turn said it was ready and why a room stopped taking turns', async () => {
    const earlier = MIGRATIONS.indexOf(DEBATE_AGREEMENT)
    database = await migratedThrough(earlier)
    expect(await database.columnsOf('debate_turns')).not.toContain('ready')
    expect(await database.columnsOf('debates')).not.toContain('concluded_because')
    expect(await database.migrate(MIGRATIONS.slice(0, earlier + 1))).toEqual([earlier + 1])
    expect(await database.columnsOf('debate_turns')).toContain('ready')
    expect(await database.columnsOf('debates')).toContain('concluded_because')
  })

  it('adds only columns that may be empty, so every room and turn before it reads as before', () => {
    for (const step of DEBATE_AGREEMENT) expect('addTo' in step && step.column.nullable).toBe(true)
  })
})
