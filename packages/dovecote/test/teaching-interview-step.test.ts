import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { TEACHING_INTERVIEW } from '../src/sql/migrations/teaching-interview-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the teaching chat step', () => {
  it('is the twenty-first step', () => {
    expect(stepNumberOf(TEACHING_INTERVIEW)).toBe(21)
  })

  it('adds the proposals and one pasted document per person, and only new tables, so it can run twice', async () => {
    const earlier = MIGRATIONS.indexOf(TEACHING_INTERVIEW)
    database = await migratedThrough(earlier)
    expect(await database.migrate(MIGRATIONS.slice(0, earlier + 1))).toEqual([earlier + 1])
    expect(await database.columnsOf('principle_proposals')).toEqual(
      expect.arrayContaining(['id', 'member_id', 'topic', 'rule', 'question', 'origin', 'rewrite_of']),
    )
    expect(await database.columnsOf('teaching_documents')).toEqual(
      expect.arrayContaining(['member_id', 'document', 'updated_at']),
    )
    await database.execute(
      `INSERT INTO teaching_documents (member_id, document, updated_at) VALUES ('mem_a', 'Refunds', 1)`,
    )
    await expect(
      database.execute(
        `INSERT INTO teaching_documents (member_id, document, updated_at) VALUES ('mem_a', 'Again', 2)`,
      ),
    ).rejects.toThrow()
    for (const step of TEACHING_INTERVIEW) expect('primaryKey' in step).toBe(true)
  })
})
