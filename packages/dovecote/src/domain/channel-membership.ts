import { Task as T } from '@homingbird/kernel'
import {
  type Channel,
  type ChannelMember,
  type ChannelVisibility,
  Conflict,
  Forbidden,
  type MemberId,
  NotFound,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { first, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import {
  type ChannelRow,
  type Viewer,
  depart,
  describeChannel,
  enter,
  helpersOf,
  isMemberOf,
  makeManager,
  managersOf,
  membersOf,
  requireManagerRemains,
  tellAboutChannel,
  visibilityOf,
  visibleChannel,
} from './channel-rows.ts'

export const channelMembers = (
  viewer: Viewer,
  slug: string,
): T.Task<ChannelMember[], ChannelFailure, AppEnv> =>
  T.gen(function* () {
    const row = yield* visibleChannel(viewer, slug)
    if (!(yield* isMemberOf(row.conversation_id, viewer.id)) && viewer.role !== 'admin')
      return yield* T.fail(Forbidden({ message: 'Join the channel to see who is in it.' }))
    const helpers = yield* helpersOf(row.conversation_id)
    const managers = yield* managersOf(row.conversation_id)
    return (yield* membersOf(row.conversation_id)).map((memberId) => ({
      memberId,
      answering: helpers.includes(memberId),
      manager: managers.includes(memberId),
    }))
  })

export const addChannelMember = (
  viewer: Viewer,
  slug: string,
  memberId: MemberId,
): T.Task<Channel, ChannelFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedPrivateChannel(
      viewer,
      slug,
      'People join an open channel by themselves.',
      'add',
    )
    yield* requireActiveMember(memberId)
    yield* enter(row.conversation_id, memberId)
    yield* tellAboutChannel(row, [memberId, ...(yield* managersOf(row.conversation_id))])
    return yield* describeChannel(viewer, row)
  })

export const removeChannelMember = (
  viewer: Viewer,
  slug: string,
  memberId: MemberId,
): T.Task<Channel, ChannelFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedPrivateChannel(
      viewer,
      slug,
      'People leave an open channel by themselves.',
      'remove',
    )
    if (!(yield* isMemberOf(row.conversation_id, memberId))) return yield* describeChannel(viewer, row)
    yield* requireManagerRemains(row, { leaving: memberId })
    yield* depart(row, memberId)
    yield* tellAboutChannel(row, yield* managersOf(row.conversation_id))
    return yield* describeChannel(viewer, row)
  })

export const grantManager = (
  viewer: Viewer,
  slug: string,
  memberId: MemberId,
): T.Task<Channel, ChannelFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedChannel(viewer, slug, 'add')
    if (!(yield* isMemberOf(row.conversation_id, memberId)))
      return yield* T.fail(Conflict({ message: 'Only a member of the channel can become its manager.' }))
    yield* makeManager(row.conversation_id, memberId)
    yield* tellAboutChannel(row, yield* managersOf(row.conversation_id))
    return yield* describeChannel(viewer, row)
  })

export const revokeManager = (
  viewer: Viewer,
  slug: string,
  memberId: MemberId,
): T.Task<Channel, ChannelFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedChannel(viewer, slug, 'remove')
    const managers = yield* managersOf(row.conversation_id)
    if (!managers.includes(memberId)) return yield* describeChannel(viewer, row)
    yield* requireManagerRemains(row, { steppingDown: memberId })
    yield* run(
      sql`DELETE FROM channel_managers WHERE conversation_id = ${row.conversation_id} AND member_id = ${memberId}`,
    )
    yield* tellAboutChannel(row, managers)
    return yield* describeChannel(viewer, row)
  })

export const setVisibility = (
  viewer: Viewer,
  slug: string,
  visibility: ChannelVisibility,
): T.Task<Channel, ChannelFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedChannel(viewer, slug, 'add')
    if (visibilityOf(row) === visibility) return yield* describeChannel(viewer, row)
    if (visibility === 'private' && (yield* managersOf(row.conversation_id)).length === 0)
      return yield* T.fail(
        Conflict({ message: 'Make a member of this channel its manager before making it private.' }),
      )
    yield* run(sql`UPDATE channels SET visibility = ${visibility} WHERE slug = ${row.slug}`)
    const changed: ChannelRow = { ...row, visibility }
    yield* tellAboutChannel(changed, yield* membersOf(row.conversation_id))
    return yield* describeChannel(viewer, changed)
  })

export type ChannelFailure = NotFound | Forbidden | Conflict

/**
 * A channel the viewer may change: its managers may do anything, and an administrator may manage an open
 * channel. In a private channel an administrator who is not its manager may only take people and roles
 * away, never give them: adding a member, making a manager, or opening the channel would let them in.
 */
const managedChannel = (
  viewer: Viewer,
  slug: string,
  change: 'add' | 'remove',
): T.Task<ChannelRow, ChannelFailure, AppEnv> =>
  T.gen(function* () {
    const row = yield* visibleChannel(viewer, slug)
    if ((yield* managersOf(row.conversation_id)).includes(viewer.id)) return row
    if (viewer.role === 'admin' && (visibilityOf(row) === 'open' || change === 'remove')) return row
    return yield* T.fail(
      Forbidden({
        message:
          visibilityOf(row) === 'private'
            ? 'Only a manager of this private channel can add members or managers, or open it.'
            : 'Only a manager of this channel can do this.',
      }),
    )
  })

const managedPrivateChannel = (
  viewer: Viewer,
  slug: string,
  whenOpen: string,
  change: 'add' | 'remove',
): T.Task<ChannelRow, ChannelFailure, AppEnv> =>
  T.gen(function* () {
    const row = yield* managedChannel(viewer, slug, change)
    if (visibilityOf(row) === 'open') return yield* T.fail(Conflict({ message: whenOpen }))
    return row
  })

const requireActiveMember = (memberId: MemberId): T.Task<void, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* first(sql`SELECT id FROM members WHERE id = ${memberId} AND status = 'active'`)
    if (row === null) return yield* T.fail(NotFound({ message: 'No such member.' }))
  })
