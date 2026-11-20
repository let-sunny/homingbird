import { Task as T } from '@homingbird/kernel'
import {
  type Channel,
  Conflict,
  type Forbidden,
  GROUP_MEMBERS_MAX,
  type Group,
  type GroupId,
  type MemberId,
  type NotFound,
  membershipChange,
} from '@homingbird/protocol'
import { type Caller, viewerOf } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { dialect, run } from '../sql/database.ts'
import { insertIgnoringConflict, sql } from '../sql/query.ts'
import { recordAudit } from './audit.ts'
import { followManagers } from './channel-agents.ts'
import {
  type ChannelRow,
  type Viewer,
  admit,
  describeChannel,
  managersOf,
  membersOf,
  tellAboutChannel,
  visibleChannel,
} from './channel-rows.ts'
import {
  type GroupRow,
  announceGroups,
  audienceOf,
  channelOfGroup,
  existingGroup,
  existingTeam,
  groupMembersOf,
  groupsOfMember,
  lockGroups,
  requireActiveMembers,
  requireAvailableGroupName,
  requireMayChangeGroup,
} from './group-rows.ts'
import { describeGroup, groupViewerOf, lockedGroup } from './groups.ts'

/**
 * Makes the group's members exactly the list given. People added to a channel's group join its room and
 * become its managers; people taken out stay in the room as members.
 */
export const setGroupMembers = (
  caller: Caller,
  id: GroupId,
  memberIds: ReadonlyArray<MemberId>,
): T.Task<Group, GroupFailure, RequestEnv> =>
  T.gen(function* () {
    const viewer = groupViewerOf(caller)
    const group = yield* lockedGroup(viewer, id)
    const before = yield* groupMembersOf(id)
    const { added, removed } = membershipChange(before, memberIds)
    yield* requireMayChangeGroup(viewer, group, added.length > 0 ? 'add' : 'remove')
    yield* requireActiveMembers(added)
    const channel = yield* channelOfGroup(group)
    if (channel !== null) yield* requireManagerInRoom(channel, before, { added, removed })
    for (const memberId of removed) yield* leaveGroup(id, memberId)
    yield* joinGroup(caller, group, channel, added, removed)
    return yield* describeGroup(viewer, group)
  })

/**
 * Adds the people in a team to a channel's managers, once: later changes to the team change nothing
 * here. It needs the right to add people to the channel's group.
 */
export const addTeamToChannel = (
  caller: Caller,
  slug: string,
  teamId: GroupId,
): T.Task<Channel, GroupFailure, RequestEnv> =>
  T.gen(function* () {
    const viewer = viewerOf(caller)
    const { channel, group, added } = yield* teamToCopy(viewer, slug, teamId)
    yield* requireMayChangeGroup(viewer, group, 'add')
    yield* joinGroup(caller, group, channel, added, [])
    return yield* describeChannel(viewer, channel)
  })

/** Locks the channel's group and the team in id order, then reads the channel and whom the team would add. */
export const teamToCopy = (
  viewer: Viewer,
  slug: string,
  teamId: GroupId,
): T.Task<{ channel: ChannelRow; group: GroupRow; added: MemberId[] }, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    yield* lockGroups([(yield* visibleChannel(viewer, slug)).manager_group_id, teamId])
    const channel = yield* visibleChannel(viewer, slug)
    const group = yield* existingGroup(channel.manager_group_id)
    yield* existingTeam(teamId)
    const before = yield* groupMembersOf(group.id)
    const { added } = membershipChange(before, [...before, ...(yield* groupMembersOf(teamId))])
    if (before.length + added.length > GROUP_MEMBERS_MAX)
      return yield* T.fail(
        Conflict({
          message: `Adding this team would give the channel more than ${GROUP_MEMBERS_MAX} managers.`,
        }),
      )
    return { channel, group, added }
  })

export const renameGroup = (
  caller: Caller,
  id: GroupId,
  name: string,
): T.Task<Group, GroupFailure, RequestEnv> =>
  T.gen(function* () {
    const viewer = groupViewerOf(caller)
    const group = yield* lockedGroup(viewer, id)
    yield* requireMayChangeGroup(viewer, group, 'add')
    if (group.kind !== 'team')
      return yield* T.fail(Conflict({ message: 'A channel’s managers are named after the channel.' }))
    yield* requireAvailableGroupName(name, id)
    yield* run(sql`UPDATE member_groups SET name = ${name} WHERE id = ${id}`)
    yield* announceGroups([id])
    return yield* describeGroup(viewer, { ...group, name })
  })

/** Takes a deactivated member out of every group, audited: the one change that may leave no manager. */
export const removeFromEveryGroup = (actor: Caller, memberId: MemberId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const groups = yield* lockedGroupsOf(memberId, new Set())
    for (const group of groups) {
      yield* leaveGroup(group.id, memberId)
      yield* recordAudit('group.members_changed', {
        caller: actor,
        targetId: group.id,
        detail: { added: [], removed: [memberId], because: 'deactivated' },
      })
      const channel = yield* channelOfGroup(group)
      const room = channel === null ? [] : yield* membersOf(channel.conversation_id)
      if (channel !== null) yield* followManagers(actor.member.id, channel)
      if (channel !== null) yield* tellAboutChannel(channel, room)
      yield* announceGroups([group.id], channel === null ? undefined : audienceOf(channel, room))
    }
  })

export type GroupFailure = NotFound | Forbidden | Conflict

/** Puts people into the group, and into its channel's room as managers, and tells who may know. */
const joinGroup = (
  caller: Caller,
  group: GroupRow,
  channel: ChannelRow | null,
  added: ReadonlyArray<MemberId>,
  removed: ReadonlyArray<MemberId>,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const target = yield* dialect
    for (const member_id of added)
      yield* run(insertIgnoringConflict(target, 'group_members', { group_id: group.id, member_id }))
    if (channel === null) return yield* announceGroups([group.id])
    yield* admit(caller, channel, added)
    yield* followManagers(caller.member.id, channel)
    yield* tellAboutChannel(channel, [...added, ...removed, ...(yield* managersOf(channel))])
    yield* announceGroups([group.id], audienceOf(channel, yield* membersOf(channel.conversation_id)))
  })

/** Taking people out of a channel's group keeps a manager in its room, if it had one, and someone in it. */
const requireManagerInRoom = (
  channel: ChannelRow,
  before: ReadonlyArray<MemberId>,
  change: { readonly added: ReadonlyArray<MemberId>; readonly removed: ReadonlyArray<MemberId> },
): T.Task<void, Conflict, RequestEnv> =>
  T.gen(function* () {
    if (change.added.length > 0 || change.removed.length === 0) return
    const managers = yield* managersOf(channel)
    const isManagedAfter = managers.some((id) => !change.removed.includes(id))
    const isEmptied = change.removed.length === before.length
    if (isManagedAfter || (managers.length === 0 && !isEmptied)) return
    return yield* T.fail(
      Conflict({ message: 'A channel keeps a manager: add someone else to its managers first.' }),
    )
  })

/** A member's groups, read again after each locking until none is new: one may gain them meanwhile. */
const lockedGroupsOf = (
  memberId: MemberId,
  locked: ReadonlySet<GroupId>,
): T.Task<ReadonlyArray<GroupRow>, never, RequestEnv> =>
  T.gen(function* () {
    const groups = yield* groupsOfMember(memberId)
    const unlocked = groups.map((group) => group.id).filter((id) => !locked.has(id))
    if (unlocked.length === 0) return groups
    yield* lockGroups(unlocked)
    return yield* lockedGroupsOf(memberId, new Set([...locked, ...unlocked]))
  })

const leaveGroup = (id: GroupId, memberId: MemberId): T.Task<number, never, RequestEnv> =>
  run(sql`DELETE FROM group_members WHERE group_id = ${id} AND member_id = ${memberId}`)
