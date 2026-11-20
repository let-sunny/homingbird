import { Task as T } from '@homingbird/kernel'
import type { GroupId, MemberId } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, insertInto, sql } from '../sql/query.ts'

/** Puts a member in a group and opens the span a team's figures count them in; true when they were not in it. */
export const addToGroup = (groupId: GroupId, memberId: MemberId): T.Task<boolean, never, AppEnv> =>
  T.gen(function* () {
    const target = yield* dialect
    const added = yield* run(
      insertIgnoringConflict(target, 'group_members', { group_id: groupId, member_id: memberId }),
    )
    if (added > 0) yield* openSpan(groupId, memberId)
    return added > 0
  })

/** Takes a member out of a group and closes their span; the number of rows taken out. */
export const removeFromGroup = (groupId: GroupId, memberId: MemberId): T.Task<number, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const removed = yield* run(
      sql`DELETE FROM group_members WHERE group_id = ${groupId} AND member_id = ${memberId}`,
    )
    yield* run(sql`UPDATE group_member_spans SET left_at = ${env.clock.now()}
      WHERE group_id = ${groupId} AND member_id = ${memberId} AND left_at IS NULL`)
    return removed
  })

/** Takes everyone out of a group that goes, closing every span it had open. */
export const emptyGroup = (groupId: GroupId): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    yield* run(sql`DELETE FROM group_members WHERE group_id = ${groupId}`)
    yield* run(
      sql`UPDATE group_member_spans SET left_at = ${env.clock.now()} WHERE group_id = ${groupId} AND left_at IS NULL`,
    )
  })

/** A member who left and came back within the same millisecond reopens that span rather than adding a second. */
const openSpan = (groupId: GroupId, memberId: MemberId): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const now = (yield* T.ask<AppEnv>()).clock.now()
    const same = yield* first(sql`SELECT joined_at FROM group_member_spans
      WHERE group_id = ${groupId} AND member_id = ${memberId} AND joined_at = ${now}`)
    if (same !== null)
      return yield* T.asUnit(
        run(sql`UPDATE group_member_spans SET left_at = NULL
          WHERE group_id = ${groupId} AND member_id = ${memberId} AND joined_at = ${now}`),
      )
    yield* run(
      insertInto('group_member_spans', {
        group_id: groupId,
        member_id: memberId,
        joined_at: now,
        left_at: null,
      }),
    )
  })
