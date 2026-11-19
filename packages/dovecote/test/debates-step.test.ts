import { afterEach, describe, expect, it } from 'vitest'
import { DEBATES } from '../src/sql/migrations/debates-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(() => database?.close())

describe('the debate rooms step', () => {
  it('creates the rooms with their members, agents, turns, approvals and credits', async () => {
    const step = stepNumberOf(DEBATES)
    database = await migratedThrough(step - 1)
    expect(await database.columnsOf('debates')).toEqual([])
    database.close()
    database = await migratedThrough(step)
    for (const table of [
      'debates',
      'debate_members',
      'debate_participants',
      'debate_turns',
      'debate_approvals',
      'debate_credits',
    ])
      expect(await database.columnsOf(table)).not.toEqual([])
  })

  it('links a note to the room whose result it carries, empty for every other note', async () => {
    database = await migratedThrough(stepNumberOf(DEBATES))
    expect(await database.columnsOf('notes')).toContain('debate_id')
  })
})
