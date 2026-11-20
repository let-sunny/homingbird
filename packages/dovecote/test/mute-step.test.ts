import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { MUTE } from '../src/sql/migrations/mute-step.ts'
import { type MigratedDatabase, migratedThrough } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the mute step', () => {
  it('adds a mute to every place in a conversation and a notification level to every member, keeping their rows', async () => {
    const earlier = MIGRATIONS.includes(MUTE) ? MIGRATIONS.indexOf(MUTE) : MIGRATIONS.length
    database = await migratedThrough(earlier)
    await database.execute(
      `INSERT INTO members (id, email, subject, name, profile, role, status, event_seq, created_at) VALUES ('mem_ana', 'ana@example.com', 'dev:ana', 'Ana', '', 'member', 'active', 0, 1)`,
    )
    await database.execute(
      `INSERT INTO conversations (id, kind, title, created_at, last_activity_at) VALUES ('conv_room00000000', 'group', null, 1, 1)`,
    )
    await database.execute(
      `INSERT INTO participants (conversation_id, member_id) VALUES ('conv_room00000000', 'mem_ana')`,
    )
    expect(await database.columnsOf('participants')).not.toContain('muted_at')
    expect(await database.columnsOf('members')).not.toContain('notifications')
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), MUTE])).toEqual([earlier + 1])
    expect(await database.columnsOf('participants')).toContain('muted_at')
    expect(await database.columnsOf('members')).toContain('notifications')
    expect(await database.execute(`UPDATE participants SET muted_at = 5 WHERE member_id = 'mem_ana'`)).toBe(1)
    expect(await database.execute(`UPDATE members SET notifications = 'none' WHERE id = 'mem_ana'`)).toBe(1)
  })

  it('adds only columns that may be empty', () => {
    for (const step of MUTE) expect('addTo' in step && step.column.nullable).toBe(true)
  })
})
