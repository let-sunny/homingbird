import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { all } from '../src/sql/database.ts'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { CLOUD_DESK } from '../src/sql/migrations/cloud-desk-step.ts'
import { INSIGHTS } from '../src/sql/migrations/insights-step.ts'
import { raw } from '../src/sql/query.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

const spans = (env: MigratedDatabase['env']) =>
  T.runPromise(
    all<Record<string, unknown>>(
      raw(
        'SELECT group_id, member_id, joined_at, left_at FROM group_member_spans ORDER BY group_id, member_id',
      ),
    ),
    env,
  )

describe('the insights step', () => {
  it('is the eleventh step, after the cloud desk', () => {
    expect(stepNumberOf(INSIGHTS)).toBe(11)
    expect(MIGRATIONS.indexOf(INSIGHTS)).toBe(MIGRATIONS.indexOf(CLOUD_DESK) + 1)
  })

  it('opens a span from before records for everyone already in a group, once however often it runs', async () => {
    const earlier = MIGRATIONS.indexOf(INSIGHTS)
    database = await migratedThrough(earlier)
    await database.execute(
      `INSERT INTO member_groups (id, kind, name, created_by, created_at) VALUES ('grp_team', 'team', 'Payments', null, 1)`,
    )
    await database.execute(`INSERT INTO group_members (group_id, member_id) VALUES ('grp_team', 'mem_ana')`)
    await database.execute(`INSERT INTO group_members (group_id, member_id) VALUES ('grp_team', 'mem_ben')`)
    expect(await database.migrate(MIGRATIONS.slice(0, earlier + 1))).toEqual([earlier + 1])
    const backfilled = [
      { group_id: 'grp_team', member_id: 'mem_ana', joined_at: 0, left_at: null },
      { group_id: 'grp_team', member_id: 'mem_ben', joined_at: 0, left_at: null },
    ]
    expect(await spans(database.env)).toEqual(backfilled)
    for (const step of INSIGHTS) if ('backfill' in step) await database.execute(step.backfill)
    expect(await spans(database.env)).toEqual(backfilled)
    expect(await database.indexesOf('group_member_spans')).not.toEqual([])
  })
})
