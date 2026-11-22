import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { CHANNEL_TEACHING } from '../src/sql/migrations/channel-teaching-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the channel teaching step', () => {
  it('is the sixteenth step, after debate pacing', () => {
    expect(stepNumberOf(CHANNEL_TEACHING)).toBe(16)
  })

  it('adds one row of instruction and sources per channel agent', async () => {
    const earlier = MIGRATIONS.indexOf(CHANNEL_TEACHING)
    database = await migratedThrough(earlier)
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), CHANNEL_TEACHING])).toEqual([earlier + 1])
    expect(await database.columnsOf('channel_agent_teaching')).toEqual(
      expect.arrayContaining(['agent_id', 'instruction', 'sources', 'updated_at']),
    )
    await database.execute(
      `INSERT INTO channel_agent_teaching (agent_id, instruction, sources, updated_at) VALUES ('mem_a', '', '[]', 1)`,
    )
    await expect(
      database.execute(
        `INSERT INTO channel_agent_teaching (agent_id, instruction, sources, updated_at) VALUES ('mem_a', '', '[]', 2)`,
      ),
    ).rejects.toThrow()
  })
})
