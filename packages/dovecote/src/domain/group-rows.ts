import { Task as T } from '@homingbird/kernel'
import { Conflict, Forbidden, GroupId, type GroupKind, type MemberId, NotFound } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { EVERYONE, type RequestEnv } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, list, sql } from '../sql/query.ts'
import {
  type ChannelRow,
  type Viewer,
  isMemberOf,
  membersOf,
  visibilityOf,
  visibleChannel,
} from './channel-rows.ts'
import { addToGroup, removeFromGroup } from './group-spans.ts'

export interface GroupRow {
  readonly id: GroupId
  readonly kind: Exclude<GroupKind, 'unknown'>
  readonly name: string | null
  readonly created_by: MemberId | null
  readonly created_at: number
}

export type GroupChange = 'add' | 'remove'

/**
 * Who may change a group. A team: administrators only. A channel's group: its members, and for a private
 * channel only while they are in its room; an administrator, for an open channel, or only to take people
 * out of a private channel's group.
 */
export const requireMayChangeGroup = (
  viewer: Viewer,
  group: GroupRow,
  change: GroupChange,
): T.Task<void, Forbidden, AppEnv> =>
  T.gen(function* () {
    if (yield* mayChangeGroup(viewer, group, change)) return
    return yield* T.fail(
      Forbidden({
        message:
          viewer.role === 'admin'
            ? 'This group manages a private channel: only its members can add people to it.'
            : group.kind === 'team'
              ? 'Only an administrator can change a team.'
              : 'Only the managers of a channel, or an administrator, can change who manages it.',
      }),
    )
  })

export const mayChangeGroup = (
  viewer: Viewer,
  group: GroupRow,
  change: GroupChange,
): T.Task<boolean, never, AppEnv> =>
  T.gen(function* () {
    const channel = yield* channelOfGroup(group)
    if (channel === null) return viewer.role === 'admin'
    const isPrivate = visibilityOf(channel) === 'private'
    const isInGroup = (yield* groupMembersOf(group.id)).includes(viewer.id)
    const isInRoom = !isPrivate || (yield* isMemberOf(channel.conversation_id, viewer.id))
    if (isInGroup && isInRoom) return true
    return viewer.role === 'admin' && (change === 'remove' || !isPrivate)
  })

/** A channel the viewer can see, read again once its group's row lock is held: group first, then channel. */
export const lockedChannel = (viewer: Viewer, slug: string): T.Task<ChannelRow, NotFound, AppEnv> =>
  T.gen(function* () {
    yield* lockGroups([(yield* visibleChannel(viewer, slug)).manager_group_id])
    return yield* visibleChannel(viewer, slug)
  })

/** Takes the row locks of several groups in id order, the order every transaction takes them in. */
export const lockGroups = (ids: Iterable<GroupId>): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    for (const id of [...new Set(ids)].sort())
      yield* run(sql`UPDATE member_groups SET created_at = created_at WHERE id = ${id}`)
  })

export const channelOfGroup = (group: GroupRow): T.Task<ChannelRow | null, never, AppEnv> =>
  group.kind === 'team'
    ? T.succeed(null)
    : first<ChannelRow>(sql`SELECT * FROM channels WHERE manager_group_id = ${group.id}`)

export const existingGroup = (id: GroupId): T.Task<GroupRow, NotFound, AppEnv> =>
  T.flatMap((row: GroupRow | null) =>
    row === null ? T.fail(NotFound({ message: 'No such group.' })) : T.succeed(row),
  )(first<GroupRow>(sql`SELECT * FROM member_groups WHERE id = ${id}`))

export const existingTeam = (id: GroupId): T.Task<GroupRow, NotFound, AppEnv> =>
  T.flatMap((row: GroupRow) =>
    row.kind === 'team' ? T.succeed(row) : T.fail(NotFound({ message: 'No such group.' })),
  )(existingGroup(id))

export const groupMembersOf = (id: GroupId): T.Task<MemberId[], never, AppEnv> =>
  T.map((rows: ReadonlyArray<{ member_id: MemberId }>) => rows.map((row) => row.member_id))(
    all(sql`
      SELECT g.member_id FROM group_members g JOIN members m ON m.id = g.member_id
      WHERE g.group_id = ${id} AND m.status = 'active' ORDER BY m.name, g.member_id`),
  )

export const groupsOfMember = (memberId: MemberId): T.Task<ReadonlyArray<GroupRow>, never, AppEnv> =>
  all<GroupRow>(sql`
    SELECT r.* FROM member_groups r JOIN group_members g ON g.group_id = r.id
    WHERE g.member_id = ${memberId} ORDER BY r.id`)

export const storeGroup = (
  group: {
    readonly kind: GroupRow['kind']
    readonly name: string | null
    readonly createdBy: MemberId | null
  },
  memberIds: ReadonlyArray<MemberId>,
): T.Task<GroupRow, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const row: GroupRow = {
      id: GroupId.of(env.random.identifier()),
      kind: group.kind,
      name: group.name,
      created_by: group.createdBy,
      created_at: env.clock.now(),
    }
    yield* run(insertInto('member_groups', { ...row }))
    for (const memberId of new Set(memberIds)) yield* addToGroup(row.id, memberId)
    return row
  })

/** Names are unique ignoring case and surrounding space, compared here so that every database agrees. */
export const requireAvailableGroupName = (
  name: string,
  except: GroupId | null,
): T.Task<void, Conflict, AppEnv> =>
  T.gen(function* () {
    const named = yield* all<{ id: GroupId; name: string }>(
      sql`SELECT id, name FROM member_groups WHERE name IS NOT NULL`,
    )
    if (named.some((row) => row.id !== except && sameName(row.name, name)))
      return yield* T.fail(Conflict({ message: 'Another group already has that name.' }))
  })

/** Only people join a group. Reads under the members' row locks, so a deactivation still committing is waited for, not missed. */
export const requireActiveMembers = (memberIds: ReadonlyArray<MemberId>): T.Task<void, NotFound, AppEnv> =>
  T.gen(function* () {
    if (memberIds.length === 0) return
    const wanted = [...new Set(memberIds)].sort()
    yield* run(sql`UPDATE members SET status = status WHERE id IN ${list(wanted)}`)
    const found = yield* all<{ id: MemberId }>(
      sql`SELECT id FROM members WHERE id IN ${list(wanted)} AND status = 'active' AND kind = 'person'`,
    )
    if (found.length < wanted.length) return yield* T.fail(NotFound({ message: 'No such member.' }))
  })

/** The last person to leave a room leaves its group too: no one manages a room from outside it. */
export const leaveGroupOfEmptiedRoom = (
  row: ChannelRow,
  memberId: MemberId,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    if ((yield* membersOf(row.conversation_id)).length > 0) return
    const left = yield* removeFromGroup(row.manager_group_id, memberId)
    if (left > 0) yield* announceGroups([row.manager_group_id], audienceOf(row, [memberId]))
  })

/** Tells that groups changed, without content: everyone, or only whom a private channel is shown to. */
export const announceGroups = (
  ids: Iterable<GroupId>,
  audience: ReadonlyArray<MemberId> | typeof EVERYONE = EVERYONE,
): T.Task<void, never, RequestEnv> =>
  T.map((env: RequestEnv) => {
    const recipients: ReadonlyArray<MemberId | typeof EVERYONE> =
      audience === EVERYONE ? [EVERYONE] : audience
    for (const groupId of new Set(ids))
      for (const memberId of recipients)
        env.outbox.push({
          memberId,
          event: { seq: 0, at: env.clock.now(), body: { type: 'group.changed', groupId } },
        })
  })(T.ask<RequestEnv>())

export const audienceOf = (
  channel: ChannelRow,
  roomMembers: ReadonlyArray<MemberId>,
): ReadonlyArray<MemberId> | typeof EVERYONE => (visibilityOf(channel) === 'open' ? EVERYONE : roomMembers)

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()
