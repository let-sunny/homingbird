import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { SLACK_CHANNELS } from '../src/sql/migrations/slack-channels-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the Slack channels step', () => {
  it('is the twenty-third step, after Slack', () => {
    expect(stepNumberOf(SLACK_CHANNELS)).toBe(23)
  })

  it('adds channel links, arrivals, threads and the outbox, and a code’s Slack channel', async () => {
    const earlier = MIGRATIONS.indexOf(SLACK_CHANNELS)
    database = await migratedThrough(earlier)
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), SLACK_CHANNELS])).toEqual([earlier + 1])
    expect(await database.columnsOf('slack_outbox')).toEqual(
      expect.arrayContaining(['note_id', 'state', 'attempts', 'uncertain', 'next_at', 'posted_ts']),
    )
    expect(await database.columnsOf('slack_arrivals')).toEqual(
      expect.arrayContaining(['note_id', 'message_ts', 'thread_ts', 'asker_member_id', 'asker_linked']),
    )
    expect(await database.columnsOf('slack_codes')).toContain('slack_channel')
  })
})
