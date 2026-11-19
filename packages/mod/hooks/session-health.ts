import type { EngineInterface } from 'claude-code'

import { FRESH_SESSION_AFTER_MINUTES, FRESH_SESSION_AT_CONTEXT_PERCENT } from './session-thresholds'
import { sessionReportOf } from './tools'

/** Whether this desk session is due for a fresh start, by the same thresholds as the web client. */
export async function isSessionDueForFreshStart($: EngineInterface): Promise<boolean> {
  const report = await sessionReportOf($)
  if (report === null) return false
  const [minutes = 0, percent = 0] = report.split(',').map(Number)
  return minutes >= FRESH_SESSION_AFTER_MINUTES || percent >= FRESH_SESSION_AT_CONTEXT_PERCENT
}
