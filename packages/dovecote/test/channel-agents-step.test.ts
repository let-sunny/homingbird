import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { all } from '../src/sql/database.ts'
import { MIGRATIONS } from '../src/sql/migrations.ts'
import { CHANNEL_AGENTS } from '../src/sql/migrations/channel-agents-step.ts'
import { raw } from '../src/sql/query.ts'
import { type MigratedDatabase, migratedThrough, stepNumberOf } from './migration-support.ts'

let database: MigratedDatabase | undefined

afterEach(async () => {
  await database?.close()
  database = undefined
})

const MEMBER = (name: string) =>
  `INSERT INTO members (id, email, subject, name, profile, role, status, event_seq, created_at) VALUES ('mem_${name}', '${name}@example.com', 'dev:${name}', '${name}', '', 'member', 'active', 0, 1)`

describe('the channel agents step', () => {
  it('is the eighth step', () => {
    expect(stepNumberOf(CHANNEL_AGENTS)).toBe(8)
  })

  it('makes every member already there a person, and adds who approved, issued and asked', async () => {
    const earlier = MIGRATIONS.indexOf(CHANNEL_AGENTS)
    database = await migratedThrough(earlier)
    await database.execute(MEMBER('ana'))
    await database.execute(MEMBER('ben'))
    expect(await database.migrate(MIGRATIONS.slice(0, earlier + 1))).toEqual([earlier + 1])
    const kinds = await T.runPromise(
      all<{ id: string; kind: string }>(raw('SELECT id, kind FROM members ORDER BY id')),
      database.env,
    )
    expect(kinds).toEqual([
      { id: 'mem_ana', kind: 'person' },
      { id: 'mem_ben', kind: 'person' },
    ])
    expect(await database.columnsOf('notes')).toContain('approved_by')
    expect(await database.columnsOf('credentials')).toContain('issued_by')
    expect(await database.columnsOf('conversations')).toEqual(
      expect.arrayContaining(['channel_id', 'asked_by']),
    )
    expect(await database.indexesOf('conversations')).toContain('conversations_channel_id_idx')
  })

  it('leaves a member another kind already has alone when it runs again', async () => {
    database = await migratedThrough(MIGRATIONS.length)
    await database.execute(MEMBER('ana'))
    await database.execute("UPDATE members SET kind = 'channel_agent' WHERE id = 'mem_ana'")
    const backfill = CHANNEL_AGENTS.find((step) => 'backfill' in step)!
    await database.execute((backfill as { backfill: string }).backfill)
    const kinds = await T.runPromise(all<{ kind: string }>(raw('SELECT kind FROM members')), database.env)
    expect(kinds).toEqual([{ kind: 'channel_agent' }])
  })

  it('adds only columns that may be empty', () => {
    for (const step of CHANNEL_AGENTS) if ('addTo' in step) expect(step.column.nullable).toBe(true)
  })
})
