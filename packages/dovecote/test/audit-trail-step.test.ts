import { afterEach, describe, expect, it } from 'vitest'
import { AUDIT_TRAIL_STEP } from '../src/sql/migrations.ts'
import { AUDIT_TRAIL } from '../src/sql/migrations/audit-trail-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(() => database?.close())

describe('the audit trail step', () => {
  it('is the step that empties the first audit table when it runs', () => {
    expect(AUDIT_TRAIL_STEP).toBe(stepNumberOf(AUDIT_TRAIL))
  })

  it('numbers audit rows itself and keeps the hash of each row and of the one before', async () => {
    database = await migratedThrough(AUDIT_TRAIL_STEP)
    expect(await database.columnsOf('audit_events')).toEqual(
      expect.arrayContaining(['id', 'event', 'outcome', 'detail', 'previous_hash', 'hash']),
    )
    await database.execute(
      "INSERT INTO audit_events (created_at, event, outcome, target_kind, detail, previous_hash, hash) VALUES (1, 'e', 'ok', 'member', '{}', 'a', 'b')",
    )
    await database.execute(
      "INSERT INTO audit_events (created_at, event, outcome, target_kind, detail, previous_hash, hash) VALUES (2, 'e', 'ok', 'member', '{}', 'b', 'c')",
    )
    expect(await database.columnsOf('audit_head')).toEqual(['name', 'last_id', 'hash'])
  })
})
