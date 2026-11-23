import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { SLACK_EDITS } from '../src/sql/migrations/slack-edits-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the Slack edits step', () => {
  it('is the twenty-eighth step, after note tags', () => {
    expect(stepNumberOf(SLACK_EDITS)).toBe(28)
  })

  it('adds when a question was edited in Slack, empty for questions that arrived before it', async () => {
    const earlier = MIGRATIONS.indexOf(SLACK_EDITS)
    database = await migratedThrough(earlier)
    await database.execute(
      `INSERT INTO slack_arrivals (note_id, conversation_id, slack_channel_id, message_ts, thread_ts, asker_slack_id, asker_name, asker_member_id, asker_linked, edited, deleted, created_at) VALUES ('note_kept00000000', 'conv_room00000000', 'C1', '1.1', '1.1', 'U1', 'Pat', null, 0, 1, 0, 1)`,
    )
    expect(await database.columnsOf('slack_arrivals')).not.toContain('edited_ts')
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), SLACK_EDITS])).toEqual([earlier + 1])
    expect(await database.columnsOf('slack_arrivals')).toContain('edited_ts')
    expect(await database.execute('UPDATE slack_arrivals SET edited = 1 WHERE edited_ts IS NULL')).toBe(1)
  })

  it('adds only a column that may be empty', () => {
    for (const step of SLACK_EDITS) expect('addTo' in step && step.column.nullable).toBe(true)
  })
})
