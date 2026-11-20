import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { CLOUD_DESK } from '../src/sql/migrations/cloud-desk-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the cloud desk step', () => {
  it('is the tenth step, after mutes', () => {
    expect(stepNumberOf(CLOUD_DESK)).toBe(10)
  })

  it('adds the table of wakes, one per member, and nothing else', async () => {
    const earlier = MIGRATIONS.indexOf(CLOUD_DESK)
    database = await migratedThrough(earlier)
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), CLOUD_DESK])).toEqual([earlier + 1])
    expect([...(await database.columnsOf('desk_wakes'))].sort()).toEqual(
      [
        'member_id',
        'credential_id',
        'host',
        'sealed',
        'enabled',
        'last_wake_at',
        'last_status',
        'failures',
        'retry_at',
        'stopped_because',
        'created_at',
        'updated_at',
      ].sort(),
    )
    expect(CLOUD_DESK.every((step) => 'primaryKey' in step)).toBe(true)
  })
})
