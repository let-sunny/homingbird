import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { MEETING_NOTICES } from '../src/sql/migrations/meeting-notices-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the meeting notices step', () => {
  it('is the thirty-second step, after scheduling delegations', () => {
    expect(stepNumberOf(MEETING_NOTICES)).toBe(32)
  })

  it('makes an empty table of meeting notices, since none was kept before', async () => {
    const earlier = MIGRATIONS.indexOf(MEETING_NOTICES)
    database = await migratedThrough(earlier)
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), MEETING_NOTICES])).toEqual([earlier + 1])
    expect(await database.columnsOf('meeting_notices')).toEqual([
      'id',
      'debate_id',
      'member_id',
      'notice',
      'about_member_id',
      'because',
      'agent_name',
      'created_at',
    ])
    expect(await database.execute('DELETE FROM meeting_notices')).toBe(0)
  })

  it('runs a second time without changing anything', async () => {
    database = await migratedThrough(MIGRATIONS.length)
    expect(await database.migrate(MIGRATIONS)).toEqual([])
  })
})
