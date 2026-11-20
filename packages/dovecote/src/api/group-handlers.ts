import { Task as T } from '@homingbird/kernel'
import { type Group, GroupId } from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import { createGroup, deleteGroup } from '../domain/group-administration.ts'
import { renameGroup, setGroupMembers } from '../domain/group-membership.ts'
import { groupById, groupViewerOf, listGroups } from '../domain/groups.ts'
import type { Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import type { Handlers } from './handlers.ts'
import { identifier } from './route-parameters.ts'

/** Groups: who is in each, and which channels each manages. */
export const groupHandlers = {
  'groups.list': (_, caller) => listGroups(groupViewerOf(caller)),
  'groups.get': ({ params }, caller) =>
    T.flatMap((id: GroupId) => groupById(groupViewerOf(caller), id))(identifier(GroupId, params.id)),
  'groups.rename': ({ params, body }, caller) =>
    T.flatMap((id: GroupId) => renameGroup(caller, id, body.name))(identifier(GroupId, params.id)),
  'groups.members.set': ({ params, body }, caller) =>
    T.flatMap((id: GroupId) => setGroupMembers(caller, id, body.memberIds))(identifier(GroupId, params.id)),
  'admin.groups.create': ({ body }, caller) =>
    T.tap(recordStartingMembers(caller))(createGroup(groupViewerOf(caller), body)),
  'admin.groups.delete': ({ params }) => T.as({})(T.flatMap(deleteGroup)(identifier(GroupId, params.id))),
} satisfies Partial<Handlers>

/** The route records that a group was made; who it starts with is a change of members like any other. */
const recordStartingMembers =
  (caller: Caller) =>
  (group: Group): T.Task<void, never, RequestEnv> =>
    group.memberIds.length === 0
      ? T.unit
      : recordAudit('group.members_changed', {
          caller,
          targetId: group.id,
          detail: { added: group.memberIds, removed: [] },
        })
