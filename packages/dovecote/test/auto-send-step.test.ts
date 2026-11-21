import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { AUTO_SEND } from '../src/sql/migrations/auto-send-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the automatic sending step', () => {
  it('is the fourteenth step, after answers from history', () => {
    expect(stepNumberOf(AUTO_SEND)).toBe(14)
  })

  it('leaves every saved answer switched off and every note sent by a person, keeping their rows', async () => {
    const earlier = MIGRATIONS.indexOf(AUTO_SEND)
    database = await migratedThrough(earlier)
    await database.execute(
      `INSERT INTO members (id, email, subject, name, profile, role, status, event_seq, created_at) VALUES ('mem_ana', 'ana@example.com', 'dev:ana', 'Ana', '', 'member', 'active', 0, 1)`,
    )
    expect(await database.columnsOf('principles')).not.toContain('auto_send')
    expect(await database.columnsOf('notes')).not.toContain('auto_principle_id')
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), AUTO_SEND])).toEqual([earlier + 1])
    expect(await database.columnsOf('principles')).toContain('auto_send')
    expect(await database.columnsOf('notes')).toEqual(
      expect.arrayContaining(['auto_principle_id', 'withdrawn_at']),
    )
    expect(await database.columnsOf('principle_auto_send_places')).toEqual(
      expect.arrayContaining(['principle_id', 'conversation_id']),
    )
    expect(
      await database.execute(
        `INSERT INTO principle_auto_send_places (principle_id, conversation_id) VALUES ('prin_a', 'conv_a')`,
      ),
    ).toBe(1)
  })

  it('adds only columns that may be empty', () => {
    for (const step of AUTO_SEND) if ('addTo' in step) expect(step.column.nullable).toBe(true)
  })
})
