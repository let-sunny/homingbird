import { Task as T } from '@homingbird/kernel'
import {
  type Channel,
  type ChannelVisibility,
  Conflict,
  ConversationId,
  Forbidden,
  type GroupId,
  type MemberId,
  type NotFound,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, run } from '../sql/database.ts'
import { containsIgnoringCase, insertInto, list, sql } from '../sql/query.ts'
import {
  type ChannelRow,
  type Viewer,
  channelOfRoom,
  channelRow,
  depart,
  describeChannel,
  enter,
  existingChannel,
  isMemberOf,
  membersOf,
  noSuchChannel,
  requireManagerRemains,
  requireOutsideManagingGroup,
  startAnswering,
  tellAboutChannel,
  visibilityOf,
  visibleChannel,
} from './channel-rows.ts'
import {
  announceGroups,
  audienceOf,
  leaveGroupOfEmptiedRoom,
  lockedChannel,
  storeGroup,
} from './group-rows.ts'

export const listChannels = (
  viewer: Viewer,
  page: { readonly search: string | undefined; readonly limit: number; readonly offset: number },
): T.Task<{ channels: Channel[]; hasMore: boolean; cursor: string | null }, never, AppEnv> =>
  T.gen(function* () {
    const { search, limit, offset } = page
    const matching = search
      ? sql`AND (${containsIgnoringCase('t.slug', search)} OR ${containsIgnoringCase('t.description', search)})`
      : sql``
    const rows = yield* all<ChannelRow>(sql`
      SELECT t.* FROM channels t WHERE ${visibleTo(viewer)} ${matching}
      ORDER BY
        CASE WHEN EXISTS (SELECT 1 FROM participants j WHERE j.conversation_id = t.conversation_id AND j.member_id = ${viewer.id}) THEN 0 ELSE 1 END,
        (SELECT COUNT(*) FROM participants m WHERE m.conversation_id = t.conversation_id) DESC,
        t.slug
      LIMIT ${limit + 1} OFFSET ${offset}`)
    const hasMore = rows.length > limit
    return {
      channels: yield* T.forEach(rows.slice(0, limit), (row) => describeChannel(viewer, row)),
      hasMore,
      cursor: hasMore ? String(offset + limit) : null,
    }
  })

export const channelNamed = (viewer: Viewer, slug: string): T.Task<Channel, NotFound, AppEnv> =>
  T.flatMap((row: ChannelRow) => describeChannel(viewer, row))(visibleChannel(viewer, slug))

/** A new channel has its own group of managers, its creator alone at first. */
export const createChannel = (
  creator: Viewer,
  channel: { readonly slug: string; readonly description: string; readonly visibility?: ChannelVisibility },
): T.Task<Channel, Conflict, RequestEnv> =>
  T.gen(function* () {
    if ((yield* channelRow(channel.slug)) !== null) return yield* T.fail(nameNotAvailable)
    const room = {
      slug: channel.slug,
      description: channel.description,
      visibility: channel.visibility ?? 'open',
    }
    const row = yield* openRoom(room, creator.id, [creator.id])
    yield* enter(row.conversation_id, creator.id)
    yield* startAnswering(row.conversation_id, creator.id)
    yield* tellAboutChannel(row, [creator.id])
    yield* announceGroups([row.manager_group_id], audienceOf(row, [creator.id]))
    return yield* describeChannel(creator, row)
  })

export const joinChannel = (
  viewer: Viewer,
  slug: string,
  answering: boolean,
): T.Task<Channel, NotFound | Forbidden, RequestEnv> =>
  T.gen(function* () {
    const row = yield* visibleChannel(viewer, slug)
    const isMember = yield* isMemberOf(row.conversation_id, viewer.id)
    if (!isMember && visibilityOf(row) === 'private')
      return yield* T.fail(Forbidden({ message: 'Only a manager of this private channel can add members.' }))
    yield* enter(row.conversation_id, viewer.id)
    if (answering) yield* startAnswering(row.conversation_id, viewer.id)
    yield* tellAboutChannel(row, [viewer.id])
    return yield* describeChannel(viewer, row)
  })

export const leaveChannel = (
  viewer: Viewer,
  slug: string,
): T.Task<Channel, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const row = yield* lockedChannel(viewer, slug)
    if (yield* isMemberOf(row.conversation_id, viewer.id)) {
      yield* requireManagerRemains(row, { leaving: viewer.id })
      yield* requireOutsideManagingGroup(row, viewer.id)
      yield* depart(row, viewer.id)
      yield* leaveGroupOfEmptiedRoom(row, viewer.id)
    }
    return yield* describeChannel(viewer, row)
  })

export const setAnswering = (
  viewer: Viewer,
  slug: string,
  answering: boolean,
): T.Task<Channel, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const row = yield* visibleChannel(viewer, slug)
    if (!(yield* isMemberOf(row.conversation_id, viewer.id)))
      return yield* T.fail(Conflict({ message: 'Join the channel before answering questions in it.' }))
    if (answering) yield* startAnswering(row.conversation_id, viewer.id)
    else
      yield* run(
        sql`DELETE FROM channel_answerers WHERE conversation_id = ${row.conversation_id} AND member_id = ${viewer.id}`,
      )
    yield* tellAboutChannel(row, [viewer.id])
    return yield* describeChannel(viewer, row)
  })

export const channelRoomFor = (askerId: MemberId, slug: string): T.Task<ConversationId, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* existingChannel(slug)
    const isMember = yield* isMemberOf(row.conversation_id, askerId)
    if (isMember) return row.conversation_id
    if (visibilityOf(row) === 'private') return yield* T.fail(noSuchChannel(slug))
    yield* enter(row.conversation_id, askerId)
    return row.conversation_id
  })

export const roomForMovedQuestion = (
  moverId: MemberId,
  askerId: MemberId,
  from: ConversationId,
  slug: string,
): T.Task<ConversationId, NotFound | Conflict, AppEnv> =>
  T.gen(function* () {
    const destination = yield* existingChannel(slug)
    const origin = yield* channelOfRoom(from)
    const isPrivate = visibilityOf(destination) === 'private'
    if (isPrivate && !(yield* isMemberOf(destination.conversation_id, moverId)))
      return yield* T.fail(noSuchChannel(slug))
    if (origin !== null && visibilityOf(origin) === 'private' && destination.conversation_id !== from) {
      const sameMembers =
        isPrivate &&
        sameSet(yield* membersOf(origin.conversation_id), yield* membersOf(destination.conversation_id))
      if (!sameMembers)
        return yield* T.fail(
          Conflict({
            message:
              'A question in a private channel can move only to another private channel with the same members.',
          }),
        )
    }
    if (isPrivate && !(yield* isMemberOf(destination.conversation_id, askerId)))
      return yield* T.fail(
        Conflict({ message: 'The person who asked is not a member of that private channel.' }),
      )
    return yield* channelRoomFor(askerId, slug)
  })

export const channelsHelpedBy = (
  viewer: Viewer,
  memberIds: ReadonlyArray<MemberId>,
): T.Task<Map<MemberId, string[]>, never, AppEnv> =>
  T.gen(function* () {
    const helped = new Map<MemberId, string[]>()
    if (memberIds.length === 0) return helped
    const rows = yield* all<{ member_id: MemberId; slug: string }>(sql`
      SELECT h.member_id, t.slug FROM channel_answerers h JOIN channels t ON t.conversation_id = h.conversation_id
      WHERE h.member_id IN ${list([...new Set(memberIds)])} AND ${sharedWith(viewer.id)} ORDER BY t.slug`)
    for (const row of rows) helped.set(row.member_id, [...(helped.get(row.member_id) ?? []), row.slug])
    return helped
  })

export const helpersOfChannelSeenBy = (viewerId: MemberId, slug: string): ReturnType<typeof sql> =>
  sql`SELECT h.member_id FROM channel_answerers h JOIN channels t ON t.conversation_id = h.conversation_id WHERE t.slug = ${slug} AND ${sharedWith(viewerId)}`

export const seedChannels: T.Task<void, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  for (const channel of env.config.channels) {
    if ((yield* channelRow(channel.slug)) !== null) continue
    yield* openRoom({ ...channel, visibility: 'open' }, null, [])
  }
})

/** Which rows of `channels t` the viewer may see: a private one only as its member or an administrator. */
export const visibleTo = (viewer: Viewer): ReturnType<typeof sql> =>
  viewer.role === 'admin' ? sql`1 = 1` : sharedWith(viewer.id)

const nameNotAvailable = Conflict({ message: 'That name is not available.' })

const sharedWith = (
  viewerId: MemberId,
): ReturnType<typeof sql> => sql`(t.visibility IS NULL OR t.visibility <> 'private'
  OR EXISTS (SELECT 1 FROM participants v WHERE v.conversation_id = t.conversation_id AND v.member_id = ${viewerId}))`

const sameSet = (a: ReadonlyArray<MemberId>, b: ReadonlyArray<MemberId>): boolean =>
  a.length === b.length && a.every((id) => b.includes(id))

const openRoom = (
  channel: { readonly slug: string; readonly description: string; readonly visibility: ChannelVisibility },
  createdBy: MemberId | null,
  managers: ReadonlyArray<MemberId>,
): T.Task<ChannelRow, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const group = yield* storeGroup({ kind: 'channel', name: null, createdBy }, managers)
    const now = env.clock.now()
    const conversationId = ConversationId.of(env.random.identifier())
    yield* run(
      insertInto('conversations', {
        id: conversationId,
        kind: 'channel',
        title: channel.slug,
        created_at: now,
        last_activity_at: now,
        pair_key: null,
      }),
    )
    const row: ChannelRow = {
      slug: channel.slug,
      description: channel.description,
      conversation_id: conversationId,
      visibility: channel.visibility,
      created_at: now,
      manager_group_id: group.id,
    }
    yield* run(insertInto('channels', { ...row, created_by: createdBy }))
    return row
  })
