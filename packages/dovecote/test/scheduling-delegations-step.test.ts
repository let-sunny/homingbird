import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { SCHEDULING_DELEGATIONS } from '../src/sql/migrations/scheduling-delegations-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the scheduling delegations step', () => {
  it('is the thirty-first step, after debate suggestions', () => {
    expect(stepNumberOf(SCHEDULING_DELEGATIONS)).toBe(31)
  })

  it('makes the delegation tables empty, so everyone delegates with no limit until they change it', async () => {
    const earlier = MIGRATIONS.indexOf(SCHEDULING_DELEGATIONS)
    database = await migratedThrough(earlier)
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), SCHEDULING_DELEGATIONS])).toEqual([
      earlier + 1,
    ])
    expect(await database.columnsOf('scheduling_delegations')).toEqual([
      'member_id',
      'auto_join',
      'auto_add',
      'credential_id',
      'brief',
      'max_minutes',
      'hours_from',
      'hours_to',
      'time_zone',
      'updated_at',
    ])
    expect(await database.columnsOf('scheduling_delegation_people')).toEqual(['member_id', 'other_member_id'])
    expect(await database.execute('DELETE FROM scheduling_delegations')).toBe(0)
  })

  it('runs a second time without changing anything', async () => {
    database = await migratedThrough(MIGRATIONS.length)
    expect(await database.migrate(MIGRATIONS)).toEqual([])
  })
})
