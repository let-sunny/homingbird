import { Schema as S } from '@homingbird/kernel'
import { DEBATE_PARTICIPANTS_MAX, UNKNOWN_RESULT } from './debate-result.ts'
import { MemberId, Timestamp } from './ids.ts'

/** The earliest time every required person who answered is free, or the closest; who did not is named. */
export const ScheduleResult = S.openVariants(
  'kind',
  {
    slot: {
      startsAt: Timestamp,
      endsAt: Timestamp,
      optionalFree: S.array(MemberId, { maxItems: DEBATE_PARTICIPANTS_MAX }),
      optionalBusy: S.array(MemberId, { maxItems: DEBATE_PARTICIPANTS_MAX }),
      unanswered: S.array(MemberId, { maxItems: DEBATE_PARTICIPANTS_MAX }),
    },
    no_slot: {
      closest: S.nullable(
        S.struct({
          startsAt: Timestamp,
          endsAt: Timestamp,
          missing: S.array(MemberId, { maxItems: DEBATE_PARTICIPANTS_MAX }),
        }),
      ),
      unanswered: S.array(MemberId, { maxItems: DEBATE_PARTICIPANTS_MAX }),
    },
  },
  UNKNOWN_RESULT,
)
export type ScheduleResult = S.Infer<typeof ScheduleResult>
