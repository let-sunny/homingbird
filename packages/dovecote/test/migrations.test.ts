import { describe, expect, it } from 'vitest'
import { AUDIT_TRAIL_STEP, MIGRATIONS } from '../src/sql/migrations.ts'
import { AUTO_SEND } from '../src/sql/migrations/auto-send-step.ts'
import { CHANNEL_AGENTS } from '../src/sql/migrations/channel-agents-step.ts'
import { CHANNEL_TEACHING } from '../src/sql/migrations/channel-teaching-step.ts'
import { CLOUD_DESK } from '../src/sql/migrations/cloud-desk-step.ts'
import { CONVERSATION_HIDING } from '../src/sql/migrations/conversation-hiding-step.ts'
import { DEBATE_AGREEMENT } from '../src/sql/migrations/debate-agreement-step.ts'
import { DEBATE_BRIEFS } from '../src/sql/migrations/debate-briefs-step.ts'
import { DEBATE_PACING } from '../src/sql/migrations/debate-pacing-step.ts'
import { DISCARDED_BY } from '../src/sql/migrations/discarded-by-step.ts'
import { DRAFT_PREVIEWS } from '../src/sql/migrations/draft-previews-step.ts'
import { HISTORY_ANSWERS } from '../src/sql/migrations/history-answers-step.ts'
import { INSIGHTS } from '../src/sql/migrations/insights-step.ts'
import { MUTE } from '../src/sql/migrations/mute-step.ts'
import { NOTE_TAGS } from '../src/sql/migrations/note-tags-step.ts'
import { SCHEDULING_ROOMS } from '../src/sql/migrations/scheduling-rooms-step.ts'
import { SLACK_CHANNELS } from '../src/sql/migrations/slack-channels-step.ts'
import { SLACK_CREDENTIALS } from '../src/sql/migrations/slack-credentials-step.ts'
import { SLACK_EDITS } from '../src/sql/migrations/slack-edits-step.ts'
import { SLACK } from '../src/sql/migrations/slack-step.ts'
import { SOURCES_AND_REASONS } from '../src/sql/migrations/sources-and-reasons-step.ts'
import { SPENT_REFRESH_TOKENS } from '../src/sql/migrations/spent-refresh-tokens-step.ts'
import { TEACHING_INTERVIEW } from '../src/sql/migrations/teaching-interview-step.ts'
import type { Step } from '../src/sql/schema-steps.ts'

const tablesOf = (steps: ReadonlyArray<Step>): string[] =>
  steps.flatMap((step) => ('primaryKey' in step ? [step.name] : []))

describe('the migrations', () => {
  it('run in a fixed order, with the audit trail as the fifth step, groups as the sixth, channel agents as the eighth, mutes as the ninth, the cloud desk as the tenth, insights as the eleventh, spent refresh tokens as the twelfth, answers from history as the thirteenth, sources and reasons as the fourteenth, debate pacing as the fifteenth, channel teaching as the sixteenth, automatic sending as the seventeenth, draft previews as the eighteenth, who discarded an answer as the nineteenth, debate agreement as the twentieth, the teaching chat as the twenty-first, Slack as the twenty-second, Slack channel links as the twenty-third, debate briefs as the twenty-fourth, hiding conversations as the twenty-fifth, the Slack app’s stored values as the twenty-sixth, note tags as the twenty-seventh, Slack edits as the twenty-eighth and scheduling rooms as the twenty-ninth', () => {
    expect(MIGRATIONS).toHaveLength(29)
    expect(MIGRATIONS.indexOf(SCHEDULING_ROOMS)).toBe(28)
    expect(MIGRATIONS.indexOf(CLOUD_DESK)).toBe(9)
    expect(MIGRATIONS.indexOf(INSIGHTS)).toBe(10)
    expect(MIGRATIONS.indexOf(SPENT_REFRESH_TOKENS)).toBe(11)
    expect(MIGRATIONS.indexOf(CHANNEL_AGENTS)).toBe(7)
    expect(MIGRATIONS.indexOf(MUTE)).toBe(8)
    expect(MIGRATIONS.indexOf(HISTORY_ANSWERS)).toBe(12)
    expect(MIGRATIONS.indexOf(SOURCES_AND_REASONS)).toBe(13)
    expect(MIGRATIONS.indexOf(DEBATE_PACING)).toBe(14)
    expect(MIGRATIONS.indexOf(CHANNEL_TEACHING)).toBe(15)
    expect(MIGRATIONS.indexOf(AUTO_SEND)).toBe(16)
    expect(MIGRATIONS.indexOf(DRAFT_PREVIEWS)).toBe(17)
    expect(MIGRATIONS.indexOf(DISCARDED_BY)).toBe(18)
    expect(MIGRATIONS.indexOf(DEBATE_AGREEMENT)).toBe(19)
    expect(MIGRATIONS.indexOf(TEACHING_INTERVIEW)).toBe(20)
    expect(MIGRATIONS.indexOf(SLACK)).toBe(21)
    expect(MIGRATIONS.indexOf(SLACK_CHANNELS)).toBe(22)
    expect(MIGRATIONS.indexOf(DEBATE_BRIEFS)).toBe(23)
    expect(MIGRATIONS.indexOf(CONVERSATION_HIDING)).toBe(24)
    expect(MIGRATIONS.indexOf(SLACK_CREDENTIALS)).toBe(25)
    expect(MIGRATIONS.indexOf(NOTE_TAGS)).toBe(26)
    expect(MIGRATIONS.indexOf(SLACK_EDITS)).toBe(27)
    expect(MIGRATIONS.at(-1)).toBe(SCHEDULING_ROOMS)
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
