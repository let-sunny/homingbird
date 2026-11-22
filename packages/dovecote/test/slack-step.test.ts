import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { SLACK } from '../src/sql/migrations/slack-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the Slack step', () => {
  it('is the twenty-second step, after the teaching chat', () => {
    expect(stepNumberOf(SLACK)).toBe(22)
  })

  it('adds the workspace, people’s links, link codes and received events, and nothing else', async () => {
    const earlier = MIGRATIONS.indexOf(SLACK)
    database = await migratedThrough(earlier)
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), SLACK])).toEqual([earlier + 1])
    expect([...(await database.columnsOf('slack_people'))].sort()).toEqual(
      ['member_id', 'slack_user_id', 'slack_name', 'linked_at'].sort(),
    )
    expect([...(await database.columnsOf('slack_events'))].sort()).toEqual(
      ['event_id', 'kind', 'payload', 'received_at', 'processed_at'].sort(),
    )
    expect(SLACK.every((step) => 'primaryKey' in step)).toBe(true)
  })
})
