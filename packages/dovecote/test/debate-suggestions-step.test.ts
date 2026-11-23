import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { DEBATE_SUGGESTIONS } from '../src/sql/migrations/debate-suggestions-step.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

describe('the debate suggestions step', () => {
  it('is the thirtieth step, after scheduling rooms', () => {
    expect(stepNumberOf(DEBATE_SUGGESTIONS)).toBe(30)
  })

  it('makes the suggestion tables and gives rooms a suggestion, empty for the rooms before it', async () => {
    const earlier = MIGRATIONS.indexOf(DEBATE_SUGGESTIONS)
    database = await migratedThrough(earlier)
    await database.execute(
      `INSERT INTO debates (id, question, visibility, status, created_by, turns_per_agent, total_turns, minutes, turn_characters, created_at, updated_at, deadline_at, result_round) VALUES ('deb_kept00000000', 'Ship it?', 'open', 'open', 'mem_ana', 1, 2, 30, 400, 1, 1, 2, 0)`,
    )
    expect(await database.columnsOf('debates')).not.toContain('suggestion_id')
    expect(await database.migrate([...MIGRATIONS.slice(0, earlier), DEBATE_SUGGESTIONS])).toEqual([
      earlier + 1,
    ])
    expect(await database.execute(`UPDATE debates SET status = 'open' WHERE suggestion_id IS NULL`)).toBe(1)
    expect(await database.columnsOf('debate_suggestions')).toEqual([
      'id',
      'member_id',
      'credential_id',
      'in_reply_to',
      'conversation_id',
      'draft_id',
      'question',
      'reason',
      'created_at',
      'decided_at',
      'decision',
      'debate_id',
      'answered_at',
    ])
    expect((await database.indexesOf('debate_suggestions')).join()).toContain('member_id_decided_at')
    expect(await database.columnsOf('debate_suggestion_people')).toEqual([
      'suggestion_id',
      'member_id',
      'position',
    ])
  })

  it('runs a second time without changing anything', async () => {
    database = await migratedThrough(MIGRATIONS.length)
    expect(await database.migrate(MIGRATIONS)).toEqual([])
  })
})
