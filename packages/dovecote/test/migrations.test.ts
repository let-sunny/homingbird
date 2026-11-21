import { describe, expect, it } from 'vitest'
import { AUDIT_TRAIL_STEP, MIGRATIONS } from '../src/sql/migrations.ts'
import { CHANNEL_AGENTS } from '../src/sql/migrations/channel-agents-step.ts'
import { CLOUD_DESK } from '../src/sql/migrations/cloud-desk-step.ts'
import { HISTORY_ANSWERS } from '../src/sql/migrations/history-answers-step.ts'
import { INSIGHTS } from '../src/sql/migrations/insights-step.ts'
import { MUTE } from '../src/sql/migrations/mute-step.ts'
import { SPENT_REFRESH_TOKENS } from '../src/sql/migrations/spent-refresh-tokens-step.ts'
import type { Step } from '../src/sql/schema-steps.ts'

const tablesOf = (steps: ReadonlyArray<Step>): string[] =>
  steps.flatMap((step) => ('primaryKey' in step ? [step.name] : []))

describe('the migrations', () => {
  it('run in a fixed order, with the audit trail as the fifth step, groups as the sixth, channel agents as the eighth, mutes as the ninth, the cloud desk as the tenth, insights as the eleventh, spent refresh tokens as the twelfth and answers from history as the thirteenth', () => {
    expect(MIGRATIONS).toHaveLength(13)
    expect(MIGRATIONS.indexOf(CLOUD_DESK)).toBe(9)
    expect(MIGRATIONS.indexOf(INSIGHTS)).toBe(10)
    expect(MIGRATIONS.indexOf(SPENT_REFRESH_TOKENS)).toBe(11)
    expect(MIGRATIONS.indexOf(CHANNEL_AGENTS)).toBe(7)
    expect(MIGRATIONS.indexOf(MUTE)).toBe(8)
    expect(MIGRATIONS.at(-1)).toBe(HISTORY_ANSWERS)
    expect(AUDIT_TRAIL_STEP).toBe(5)
  })

  it('never create a table twice, and add columns and indexes only to tables an earlier step made', () => {
    const created: string[] = []
    for (const steps of MIGRATIONS) {
      for (const step of steps) {
        if ('addTo' in step) expect(created).toContain(step.addTo)
        if ('indexOn' in step) expect(created).toContain(step.indexOn)
      }
      for (const table of tablesOf(steps)) {
        expect(created).not.toContain(table)
        created.push(table)
      }
    }
  })

  it('add only columns that may be empty, so a step can run against rows that already exist', () => {
    for (const step of MIGRATIONS.flat()) if ('addTo' in step) expect(step.column.nullable).toBe(true)
  })
})
