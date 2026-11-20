import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { all } from '../src/sql/database.ts'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { GROUPS } from '../src/sql/migrations/groups-step.ts'
import { raw } from '../src/sql/query.ts'
import {
  CHANNELS_WITH_MANAGERS,
  GROUPS_FROM_MANAGERS,
  type MigratedDatabase,
  groupsAndManagers,
  migratedThrough,
  stepNumberOf,
} from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(() => database?.close())

const step = stepNumberOf(GROUPS)
const backfills = GROUPS.flatMap((each) => ('backfill' in each ? [each.backfill] : []))

const upgraded = async (): Promise<MigratedDatabase> => {
  const opened = await migratedThrough(step - 1)
  for (const statement of CHANNELS_WITH_MANAGERS) await opened.execute(statement)
  expect(await opened.migrate(MIGRATIONS.slice(0, step))).toEqual([step])
  return opened
}

const read = (opened: MigratedDatabase) =>
  groupsAndManagers((query) => T.runPromise(all<Record<string, unknown>>(raw(query)), opened.env))

describe('the groups step', () => {
  it('is the sixth step and adds the group tables and the managing group of a channel', async () => {
    expect(step).toBe(6)
    database = await migratedThrough(step - 1)
    expect(await database.columnsOf('channels')).not.toContain('manager_group_id')
    expect(await database.migrate(MIGRATIONS.slice(0, step))).toEqual([step])
    expect(await database.columnsOf('member_groups')).toEqual([
      'id',
      'kind',
      'name',
      'created_by',
      'created_at',
    ])
    expect(await database.columnsOf('group_members')).toEqual(['group_id', 'member_id'])
    expect(await database.indexesOf('group_members')).toContain('group_members_member_id_idx')
    expect(await database.columnsOf('channels')).toContain('manager_group_id')
    expect(await database.indexesOf('channels')).toContain('channels_manager_group_id_idx')
  })

  it('gives every channel an unnamed channel group of its active managers still in its room, and nothing else', async () => {
    database = await upgraded()
    expect(await read(database)).toEqual(GROUPS_FROM_MANAGERS)
  })

  it('changes nothing when its backfills run a second time', async () => {
    database = await upgraded()
    for (const statement of backfills) await database.execute(statement)
    expect(await read(database)).toEqual(GROUPS_FROM_MANAGERS)
  })

  it('never replaces a channel’s managing group, and keeps the old list of managers', async () => {
    database = await upgraded()
    await database.execute("UPDATE channels SET manager_group_id = 'grp_another00000' WHERE slug = 'payroll'")
    await database.execute("DELETE FROM member_groups WHERE id = 'grp_payroll00000'")
    for (const statement of backfills) await database.execute(statement)
    expect((await read(database)).channels).toContainEqual({
      slug: 'payroll',
      manager_group_id: 'grp_another00000',
    })
    expect(
      await T.runPromise(all(raw('SELECT member_id FROM channel_managers ORDER BY member_id')), database.env),
    ).toHaveLength(5)
  })
})
