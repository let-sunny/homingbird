import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { SCHEDULING_ROOMS } from '../src/sql/migrations/scheduling-rooms-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the scheduling rooms step', () => {
  it('is the last step, the twenty-ninth, after Slack edits', () => {
    expect(stepNumberOf(SCHEDULING_ROOMS)).toBe(MIGRATIONS.length)
    expect(stepNumberOf(SCHEDULING_ROOMS)).toBe(29)
  })

  it('gives rooms a type, empty for the debates before it, and makes the scheduling tables', async () => {
    const earlier = MIGRATIONS.indexOf(SCHEDULING_ROOMS)
    database = await migratedThrough(earlier)
    await database.execute(
      `INSERT INTO debates (id, question, visibility, status, created_by, turns_per_agent, total_turns, minutes, turn_characters, created_at, updated_at, deadline_at, result_round) VALUES ('deb_kept00000000', 'Ship it?', 'open', 'open', 'mem_ana', 1, 2, 30, 400, 1, 1, 2, 0)`,
    )
    expect(await database.columnsOf('debates')).not.toContain('room_type')
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), SCHEDULING_ROOMS])).toEqual([earlier + 1])
    expect(await database.execute(`UPDATE debates SET status = 'open' WHERE room_type IS NULL`)).toBe(1)
    expect(await database.columnsOf('scheduling_rooms')).toEqual([
      'debate_id',
      'minutes',
      'window_starts_at',
      'window_ends_at',
      'slot_starts_at',
      'invite_uid',
      'meeting_url',
      'invite_state',
      'invite_changed_at',
    ])
    expect(await database.columnsOf('scheduling_attendees')).toContain('answer')
    expect((await database.indexesOf('scheduling_attendees')).join()).toContain('member_id')
    expect(await database.columnsOf('room_free_slots')).toEqual([
      'debate_id',
      'member_id',
      'starts_at',
      'ends_at',
      'by_person',
      'created_at',
    ])
  })

  it('runs a second time without changing anything', async () => {
    database = await migratedThrough(MIGRATIONS.length)
    expect(await database.migrate(MIGRATIONS)).toEqual([])
  })
})
