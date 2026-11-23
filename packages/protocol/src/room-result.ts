import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN_RESULT, conclusionFields, noConclusionFields } from './debate-result.ts'
import { scheduleResultCases } from './schedule-result.ts'

/** What a flock settled: a debate's conclusion or open points, or a scheduling flock's time. */
export const RoomResult = S.openVariants(
  'kind',
  { conclusion: conclusionFields, no_conclusion: noConclusionFields, ...scheduleResultCases() },
  UNKNOWN_RESULT,
)
export type RoomResult = S.Infer<typeof RoomResult>
