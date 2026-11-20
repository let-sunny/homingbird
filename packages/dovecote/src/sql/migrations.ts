import { AUDIT_TRAIL } from './migrations/audit-trail-step.ts'
import { BASELINE } from './migrations/baseline-step.ts'
import { CHANNEL_AGENTS } from './migrations/channel-agents-step.ts'
import { CLOUD_DESK } from './migrations/cloud-desk-step.ts'
import { DEBATE_MODEL } from './migrations/debate-model-step.ts'
import { DEBATES } from './migrations/debates-step.ts'
import { GROUPS } from './migrations/groups-step.ts'
import { INSIGHTS } from './migrations/insights-step.ts'
import { MUTE } from './migrations/mute-step.ts'
import { RESULT_VOTES } from './migrations/result-votes-step.ts'
import { TEACHING_AND_FIGURES } from './migrations/teaching-and-figures-step.ts'
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
]

/** The step that added the audit trail; when it runs, the first audit table's old rows go. */
export const AUDIT_TRAIL_STEP = MIGRATIONS.indexOf(AUDIT_TRAIL) + 1
