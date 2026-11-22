import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { SLACK_CREDENTIALS } from '../src/sql/migrations/slack-credentials-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the Slack credentials step', () => {
  it('is the last step, the twenty-sixth, after conversation hiding', () => {
    expect(stepNumberOf(SLACK_CREDENTIALS)).toBe(MIGRATIONS.length)
    expect(stepNumberOf(SLACK_CREDENTIALS)).toBe(26)
  })

  it('adds one slot for the sealed values, with who gave them and when, and nothing in plain text', async () => {
    const earlier = MIGRATIONS.indexOf(SLACK_CREDENTIALS)
    database = await migratedThrough(earlier)
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), SLACK_CREDENTIALS])).toEqual([
      earlier + 1,
    ])
    expect((await database.columnsOf('slack_credentials')).sort()).toEqual(
      ['bot_token_sealed', 'given_at', 'given_by', 'signing_secret_sealed', 'slot'].sort(),
    )
    await database.execute(
      `INSERT INTO slack_credentials (slot, given_by, bot_token_sealed, signing_secret_sealed, given_at) VALUES ('app', 'mem_ana', 'v1.a', 'v1.b', 1)`,
    )
    await expect(
      database.execute(
        `INSERT INTO slack_credentials (slot, given_by, bot_token_sealed, signing_secret_sealed, given_at) VALUES ('app', 'mem_ben', 'v1.c', 'v1.d', 2)`,
      ),
    ).rejects.toThrow()
  })
})
