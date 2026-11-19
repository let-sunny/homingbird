import { Task as T } from '@homingbird/kernel'
import type { Achievement, DebateCredit, MemberId } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all } from '../sql/database.ts'
import { sql } from '../sql/query.ts'

/** The kinds of credit approved debate results gave this person's agent, each kind once: never a count. */
export const debateCreditsOf = (memberId: MemberId): T.Task<DebateCredit[], never, AppEnv> =>
  T.map((rows: ReadonlyArray<{ kind: DebateCredit }>) => rows.map((row) => row.kind))(
    all<{ kind: DebateCredit }>(
      sql`SELECT DISTINCT kind FROM debate_credits WHERE member_id = ${memberId} ORDER BY kind`,
    ),
  )

/** The milestone each kind of credit marks the first time it is earned. */
export const debateAchievementsOf = (credits: ReadonlyArray<DebateCredit>): Achievement[] =>
  credits.map((credit) => ACHIEVEMENT_OF[credit])

const ACHIEVEMENT_OF: Readonly<Record<DebateCredit, Achievement>> = {
  conclusion: 'debate_conclusion',
  gap_filled: 'debate_gap_filled',
  disagreement_separated: 'debate_disagreement_separated',
  position_changed: 'debate_position_changed',
  next_step_accepted: 'debate_next_step_accepted',
}
