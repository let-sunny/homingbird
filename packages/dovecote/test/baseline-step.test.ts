import { afterEach, describe, expect, it } from 'vitest'
import { BASELINE } from '../src/sql/migrations/baseline-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(() => database?.close())

describe('the baseline step', () => {
  it('is the first step and creates the tables a note, its receipts and its events need', async () => {
    expect(stepNumberOf(BASELINE)).toBe(1)
    database = await migratedThrough(1)
    expect(await database.columnsOf('notes')).toEqual(
      expect.arrayContaining([
        'id',
        'conversation_id',
        'author_id',
        'status',
        'body',
        'in_reply_to',
        'sent_at',
      ]),
    )
    expect(await database.columnsOf('receipts')).toEqual(
      expect.arrayContaining([
        'note_id',
        'member_id',
        'delivered_at',
        'read_at',
        'drafting_at',
        'replied_at',
      ]),
    )
    expect(await database.columnsOf('events')).toEqual(expect.arrayContaining(['member_id', 'seq', 'body']))
  })

  it('gives every table a primary key and leaves the later columns to later steps', async () => {
    expect(BASELINE.every((table) => table.primaryKey.length > 0)).toBe(true)
    database = await migratedThrough(1)
    expect(await database.columnsOf('notes')).not.toContain('decided_at')
    expect(await database.columnsOf('debates')).toEqual([])
  })

  it('keeps one direct conversation per pair of members', async () => {
    database = await migratedThrough(1)
    await database.execute(
      "INSERT INTO conversations (id, kind, title, pair_key, created_at, last_activity_at) VALUES ('c1', 'direct', NULL, 'a:b', 1, 1)",
    )
    await expect(
      database.execute(
        "INSERT INTO conversations (id, kind, title, pair_key, created_at, last_activity_at) VALUES ('c2', 'direct', NULL, 'a:b', 1, 1)",
      ),
    ).rejects.toThrow(/UNIQUE/)
  })
})
