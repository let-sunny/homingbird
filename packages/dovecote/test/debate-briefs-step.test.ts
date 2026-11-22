import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { DEBATE_BRIEFS } from '../src/sql/migrations/debate-briefs-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the debate briefs step', () => {
  it('is the last step', () => {
    expect(stepNumberOf(DEBATE_BRIEFS)).toBe(MIGRATIONS.length)
  })

  it('adds a person’s note on what their agent may use to every participant, empty for those before it', async () => {
    const earlier = MIGRATIONS.indexOf(DEBATE_BRIEFS)
    database = await migratedThrough(earlier)
    await database.execute(
      `INSERT INTO debate_participants (debate_id, member_id, credential_id, agent_name, created_at) VALUES ('debate_kept0000', 'mem_ana', 'cred_ana', 'Laptop', 1)`,
    )
    expect(await database.columnsOf('debate_participants')).not.toContain('brief')
    expect(await database.migrate(MIGRATIONS.slice(0, earlier + 1))).toEqual([earlier + 1])
    expect(await database.columnsOf('debate_participants')).toContain('brief')
    expect(
      await database.execute(
        `UPDATE debate_participants SET brief = 'Q3 budget only.' WHERE debate_id = 'debate_kept0000' AND brief IS NULL`,
      ),
    ).toBe(1)
  })

  it('adds only a column that may be empty and holds a long note', () => {
    for (const step of DEBATE_BRIEFS)
      expect('addTo' in step && step.column).toEqual({ type: 'text', nullable: true })
  })
})
