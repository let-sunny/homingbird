import { Task as T } from '@homingbird/kernel'
import { Conflict, type Group, type GroupId, type MemberId, type NotFound } from '@homingbird/protocol'
import type { RequestEnv } from '../events/events.ts'
import { run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import {
  announceGroups,
  existingGroup,
  requireActiveMembers,
  requireAvailableGroupName,
  storeGroup,
} from './group-rows.ts'
import { emptyGroup } from './group-spans.ts'
import { type GroupViewer, describeGroup } from './groups.ts'

/** An administrator makes teams; only administrators change them, and a team manages no channel. */
export const createGroup = (
  viewer: GroupViewer,
  group: { readonly name: string; readonly memberIds?: ReadonlyArray<MemberId> },
): T.Task<Group, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const memberIds = group.memberIds ?? []
    yield* requireAvailableGroupName(group.name, null)
    yield* requireActiveMembers(memberIds)
    const row = yield* storeGroup({ kind: 'team', name: group.name, createdBy: viewer.id }, memberIds)
    yield* announceGroups([row.id])
    return yield* describeGroup(viewer, row)
  })

/** Deletes a team; a channel's group of managers goes only with its channel. */
export const deleteGroup = (id: GroupId): T.Task<void, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const group = yield* existingGroup(id)
    if (group.kind !== 'team')
      return yield* T.fail(
        Conflict({ message: 'A channel’s managers go only when the channel is archived.' }),
      )
    yield* emptyGroup(id)
    yield* run(sql`DELETE FROM member_groups WHERE id = ${id}`)
    yield* announceGroups([id])
  })
