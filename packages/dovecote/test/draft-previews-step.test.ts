import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { DRAFT_PREVIEWS } from '../src/sql/migrations/draft-previews-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the draft previews step', () => {
  it('is the eighteenth step, after automatic sending', () => {
    expect(stepNumberOf(DRAFT_PREVIEWS)).toBe(18)
  })

  it('adds one allowance row per person and target, and when a previewed draft was withdrawn', async () => {
    const earlier = MIGRATIONS.indexOf(DRAFT_PREVIEWS)
    database = await migratedThrough(earlier)
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), DRAFT_PREVIEWS])).toEqual([earlier + 1])
    expect(await database.columnsOf('draft_preview_allowances')).toEqual(
      expect.arrayContaining(['member_id', 'kind', 'target_id', 'created_at']),
    )
    expect(await database.columnsOf('notes')).toContain('preview_withdrawn_at')
    const insert = `INSERT INTO draft_preview_allowances (member_id, kind, target_id, created_at) VALUES ('mem_a', 'person', 'mem_b', 1)`
    expect(await database.execute(insert)).toBe(1)
    await expect(database.execute(insert)).rejects.toThrow()
  })
})
