import { AUDIT_TRAIL } from './migrations/audit-trail-step.ts'
import { AUTO_SEND } from './migrations/auto-send-step.ts'
import { BASELINE } from './migrations/baseline-step.ts'
import { CHANNEL_AGENTS } from './migrations/channel-agents-step.ts'
import { CHANNEL_TEACHING } from './migrations/channel-teaching-step.ts'
import { CLOUD_DESK } from './migrations/cloud-desk-step.ts'
import { DEBATE_AGREEMENT } from './migrations/debate-agreement-step.ts'
import { DEBATE_BRIEFS } from './migrations/debate-briefs-step.ts'
import { DEBATE_MODEL } from './migrations/debate-model-step.ts'
import { DEBATE_PACING } from './migrations/debate-pacing-step.ts'
import { DEBATES } from './migrations/debates-step.ts'
import { DISCARDED_BY } from './migrations/discarded-by-step.ts'
import { DRAFT_PREVIEWS } from './migrations/draft-previews-step.ts'
import { GROUPS } from './migrations/groups-step.ts'
import { HISTORY_ANSWERS } from './migrations/history-answers-step.ts'
import { INSIGHTS } from './migrations/insights-step.ts'
import { MUTE } from './migrations/mute-step.ts'
import { RESULT_VOTES } from './migrations/result-votes-step.ts'
import { SOURCES_AND_REASONS } from './migrations/sources-and-reasons-step.ts'
import { SPENT_REFRESH_TOKENS } from './migrations/spent-refresh-tokens-step.ts'
import { TEACHING_AND_FIGURES } from './migrations/teaching-and-figures-step.ts'
import { TEACHING_INTERVIEW } from './migrations/teaching-interview-step.ts'
import type { Migration } from './schema-steps.ts'

export const MIGRATIONS: ReadonlyArray<Migration> = [
  BASELINE,
  TEACHING_AND_FIGURES,
  DEBATES,
  RESULT_VOTES,
  AUDIT_TRAIL,
  GROUPS,
  DEBATE_MODEL,
  CHANNEL_AGENTS,
  MUTE,
  CLOUD_DESK,
  INSIGHTS,
  SPENT_REFRESH_TOKENS,
  HISTORY_ANSWERS,
  SOURCES_AND_REASONS,
  DEBATE_PACING,
  CHANNEL_TEACHING,
  AUTO_SEND,
  DRAFT_PREVIEWS,
  DISCARDED_BY,
  DEBATE_AGREEMENT,
  TEACHING_INTERVIEW,
  DEBATE_BRIEFS,
]

/** The step that added the audit trail; when it runs, the first audit table's old rows go. */
export const AUDIT_TRAIL_STEP = MIGRATIONS.indexOf(AUDIT_TRAIL) + 1
