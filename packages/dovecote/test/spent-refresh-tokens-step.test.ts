import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { SPENT_REFRESH_TOKENS } from '../src/sql/migrations/spent-refresh-tokens-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the spent refresh tokens step', () => {
  it('is the last step', () => {
    expect(stepNumberOf(SPENT_REFRESH_TOKENS)).toBe(MIGRATIONS.length)
  })

  it('adds a table of spent refresh tokens, one row per hash', async () => {
    const earlier = MIGRATIONS.indexOf(SPENT_REFRESH_TOKENS)
    database = await migratedThrough(earlier)
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), SPENT_REFRESH_TOKENS])).toEqual([
      earlier + 1,
    ])
    expect(await database.columnsOf('spent_refresh_tokens')).toEqual(
      expect.arrayContaining(['refresh_hash', 'credential_id', 'spent_at']),
    )
    expect(
      await database.execute(
        `INSERT INTO spent_refresh_tokens (refresh_hash, credential_id, spent_at) VALUES ('h', 'cred_a', 1)`,
      ),
    ).toBe(1)
    await expect(
      database.execute(
        `INSERT INTO spent_refresh_tokens (refresh_hash, credential_id, spent_at) VALUES ('h', 'cred_b', 2)`,
      ),
    ).rejects.toThrow()
  })
})
