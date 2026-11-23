import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { SCHEDULING_LIMITS } from '../src/sql/migrations/scheduling-limits-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the scheduling limits step', () => {
  it('is the last step, the thirty-third, after meeting notices', () => {
    expect(stepNumberOf(SCHEDULING_LIMITS)).toBe(MIGRATIONS.length)
    expect(stepNumberOf(SCHEDULING_LIMITS)).toBe(33)
  })

  it('adds the limits to a room, leaving a room stored before it without any', async () => {
    const earlier = MIGRATIONS.indexOf(SCHEDULING_LIMITS)
    database = await migratedThrough(earlier)
    await database.execute(
      "INSERT INTO scheduling_rooms (debate_id, minutes, window_starts_at, window_ends_at) VALUES ('room', 30, 1, 2)",
    )
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), SCHEDULING_LIMITS])).toEqual([
      earlier + 1,
    ])
    expect(await database.columnsOf('scheduling_rooms')).toEqual(
      expect.arrayContaining(['weekdays', 'hours_from', 'hours_to', 'time_zone']),
    )
    expect(await database.execute('UPDATE scheduling_rooms SET minutes = 30 WHERE time_zone IS NULL')).toBe(1)
  })

  it('runs a second time without changing anything', async () => {
    database = await migratedThrough(MIGRATIONS.length)
    expect(await database.migrate(MIGRATIONS)).toEqual([])
  })
})
