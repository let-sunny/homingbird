import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { CONVERSATION_HIDING } from '../src/sql/migrations/conversation-hiding-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the conversation hiding step', () => {
  it('is the last step, the twenty-third, after Slack', () => {
    expect(stepNumberOf(CONVERSATION_HIDING)).toBe(MIGRATIONS.length)
    expect(stepNumberOf(CONVERSATION_HIDING)).toBe(23)
  })

  it('adds a hide to every place in a conversation, keeping each place shown', async () => {
    const earlier = MIGRATIONS.indexOf(CONVERSATION_HIDING)
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
    expect(await database.columnsOf('participants')).not.toContain('hidden_at')
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), CONVERSATION_HIDING])).toEqual([
      earlier + 1,
    ])
    expect(await database.columnsOf('participants')).toContain('hidden_at')
    expect(
      await database.execute(
        `UPDATE participants SET hidden_at = 5 WHERE member_id = 'mem_ana' AND hidden_at IS NULL`,
      ),
    ).toBe(1)
  })

  it('adds only columns that may be empty', () => {
    for (const step of CONVERSATION_HIDING) expect('addTo' in step && step.column.nullable).toBe(true)
  })
})
