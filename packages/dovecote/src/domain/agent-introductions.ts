import { Task as T } from '@homingbird/kernel'
import type { MemberId } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all } from '../sql/database.ts'
import { list, sql } from '../sql/query.ts'
import { featureIsOn } from './settings.ts'

/** The sentences a member made public about their agent, in their order; nothing else of their principles. */
export const agentIntroductionsOf = (
  memberIds: ReadonlyArray<MemberId>,
): T.Task<Map<MemberId, string[]>, never, AppEnv> =>
  T.gen(function* () {
    if (memberIds.length === 0 || !(yield* featureIsOn('teaching'))) return new Map()
    const rows = yield* all<{ member_id: MemberId; public_text: string }>(sql`
      SELECT member_id, public_text FROM principles
      WHERE member_id IN ${list([...new Set(memberIds)])} AND public_text IS NOT NULL AND enabled = 1
      ORDER BY position, created_at, id`)
    const byMember = Map.groupBy(rows, (row) => row.member_id)
    return new Map([...byMember].map(([id, entries]) => [id, entries.map((row) => row.public_text)]))
  })
