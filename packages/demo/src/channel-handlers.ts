import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  type Channel,
  Conflict,
  type ConversationId,
  type GroupId,
  type MemberId,
  NotFound,
} from '@homingbird/protocol'
import { type Handlers, found } from './handlers.ts'
import { channelAgentReportOf } from './insights.ts'
import { channelAsSeen, conversationAsSeen, groupsOf, managersOf, memberById, reviewsOf } from './reads.ts'
import type { ChannelRecord, ConversationRecord, Records } from './world.ts'
import type { World } from './world.ts'

/** Channels, the groups that manage them, private questions to a channel's agent, and its answers waiting for review. */
export const channelHandlers = (world: World): Handlers => ({
  'channels.list': ({ query }, viewerId) =>
    T.sync(() => {
      const needle = query.q?.trim().toLowerCase() ?? ''
      const records = world.records()
      return {
        channels: records.channels
          .filter((channel) => isVisible(records, viewerId, channel))
          .filter((channel) => `${channel.slug} ${channel.description}`.toLowerCase().includes(needle))
          .sort((a, b) => a.slug.localeCompare(b.slug))
          .map((channel) => channelAsSeen(records, viewerId, channel)),
        hasMore: false,
        cursor: null,
      }
    }),
  'channels.get': ({ params }, viewerId) => seen(world, viewerId, params.slug),
  'channels.create': ({ body }, viewerId) =>
    T.gen(function* () {
      if (world.records().channels.some((channel) => channel.slug === body.slug))
        return yield* T.fail(Conflict({ message: 'A channel with that name already exists.' }))
      const now = world.clock.now()
      const managedBy = world.nextId('grp') as GroupId
      const conversationId = world.nextId('conv') as ConversationId
      world.update((records) => ({
        ...records,
        conversations: [
          ...records.conversations,
          {
            id: conversationId,
            kind: 'channel',
            title: body.slug,
            participantIds: [viewerId],
            createdAt: now,
            lastActivityAt: now,
            mutedBy: [],
          },
        ],
        groups: [
          ...records.groups,
          { id: managedBy, kind: 'channel', name: null, memberIds: [viewerId], createdAt: now },
        ],
        channels: [
          ...records.channels,
          {
            slug: body.slug,
            description: body.description,
            conversationId,
            visibility: body.visibility === 'private' ? 'private' : 'open',
            answering: [],
            managedBy,
            agentId: null,
            createdAt: now,
          },
        ],
      }))
      return yield* announced(world, viewerId, body.slug)
    }),
  'channels.join': ({ params, body }, viewerId) =>
    changeChannel(world, viewerId, params.slug, (records, channel) => ({
      ...records,
      conversations: records.conversations.map((room) =>
        room.id === channel.conversationId && !room.participantIds.includes(viewerId)
          ? { ...room, participantIds: [...room.participantIds, viewerId] }
          : room,
      ),
      channels: body.answering === true ? withAnswering(records, channel, viewerId, true) : records.channels,
    })),
  'channels.leave': ({ params }, viewerId) =>
    T.gen(function* () {
      const channel = yield* channelOf(world.records(), viewerId, params.slug)
      if (managersOf(world.records(), channel).includes(viewerId))
        return yield* T.fail(Conflict({ message: 'A manager leaves the managing group before the channel.' }))
      world.update((records) => ({
        ...records,
        conversations: records.conversations.map((room) =>
          room.id === channel.conversationId
            ? { ...room, participantIds: room.participantIds.filter((id) => id !== viewerId) }
            : room,
        ),
        channels: withAnswering(records, channel, viewerId, false),
      }))
      world.emit([viewerId], {
        type: 'channel.left',
        slug: channel.slug,
        conversationId: channel.conversationId,
      })
      return yield* seen(world, viewerId, channel.slug)
    }),
  'channels.answering.on': ({ params }, viewerId) =>
    changeChannel(world, viewerId, params.slug, (records, channel) => ({
      ...records,
      channels: withAnswering(records, channel, viewerId, true),
    })),
  'channels.answering.off': ({ params }, viewerId) =>
    changeChannel(world, viewerId, params.slug, (records, channel) => ({
      ...records,
      channels: withAnswering(records, channel, viewerId, false),
    })),
  'channels.members.list': ({ params }, viewerId) =>
    T.map((channel: ChannelRecord) => {
      const records = world.records()
      const managers = managersOf(records, channel)
      const room = records.conversations.find((each) => each.id === channel.conversationId)
      return {
        members: (room?.participantIds ?? [])
          .filter((id) => memberById(records, id)?.kind === 'person')
          .map((memberId) => ({
            memberId,
            answering: channel.answering.includes(memberId),
            manager: managers.includes(memberId),
          })),
      }
    })(channelOf(world.records(), viewerId, params.slug)),
  'channels.agent.get': ({ params }, viewerId) =>
    T.gen(function* () {
      const records = world.records()
      const channel = yield* managedChannel(records, viewerId, params.slug)
      const agent = yield* found(
        channel.agentId === null ? null : memberById(records, channel.agentId),
        'This channel has no agent.',
      )
      return {
        agent,
        channel: channel.slug,
        credentials: records.credentials
          .filter((each) => each.memberId === agent.id)
          .map((each) => ({ ...each.credential, issuedBy: each.issuedBy })),
      }
    }),
  'channels.agent.figures': ({ params }, viewerId) =>
    T.gen(function* () {
      const records = world.records()
      const channel = yield* managedChannel(records, viewerId, params.slug)
      const agentId = yield* found(channel.agentId, 'This channel has no agent.')
      return channelAgentReportOf(records, channel.slug, agentId, world.startedAt, world.clock.now())
    }),
  'channels.askPrivately': ({ params }, viewerId) =>
    T.gen(function* () {
      const channel = yield* channelOf(world.records(), viewerId, params.slug)
      if (channel.visibility === 'private' && !isInRoom(world.records(), viewerId, channel))
        return yield* T.fail(NotFound({ message: 'No such channel.' }))
      const agentId = channel.agentId
      if (agentId === null) return yield* T.fail(Conflict({ message: 'This channel has no agent to ask.' }))
      const room = privateQuestionOf(world, viewerId, channel, agentId)
      return conversationAsSeen(world.records(), viewerId, room)
    }),
  'reviews.list': (_, viewerId) => T.sync(() => ({ reviews: reviewsOf(world.records(), viewerId) })),
  'reviews.get': ({ params }, viewerId) =>
    found(
      reviewsOf(world.records(), viewerId).find((review) => review.note.id === params.id),
      'No such answer waits for you.',
    ),
  'groups.list': (_, viewerId) => T.sync(() => ({ groups: groupsOf(world.records(), viewerId) })),
  'groups.get': ({ params }, viewerId) =>
    found(
      groupsOf(world.records(), viewerId).find((group) => group.id === params.id),
      'No such group.',
    ),
  'groups.rename': ({ params, body }, viewerId) =>
    T.gen(function* () {
      const group = yield* found(
        groupsOf(world.records(), viewerId).find(
          (each) => each.id === params.id && each.kind === 'team' && each.mayAdd,
        ),
        'No such group.',
      )
      const name = body.name
      if (world.records().groups.some((each) => each.id !== group.id && each.name === name))
        return yield* T.fail(Conflict({ message: 'Another group has this name.' }))
      world.update((records) => ({
        ...records,
        groups: records.groups.map((each) => (each.id === group.id ? { ...each, name } : each)),
      }))
      world.emit(
        world.records().members.map(({ member }) => member.id),
        { type: 'group.changed', groupId: group.id },
      )
      return yield* found(
        groupsOf(world.records(), viewerId).find((each) => each.id === group.id),
        'No such group.',
      )
    }),
  'groups.members.set': ({ params, body }, viewerId) =>
    T.gen(function* () {
      const group = yield* found(
        groupsOf(world.records(), viewerId).find((each) => each.id === params.id && each.mayAdd),
        'No such group.',
      )
      const people = body.memberIds.filter((id) => memberById(world.records(), id)?.kind === 'person')
      if (people.length === 0 && group.kind === 'channel')
        return yield* T.fail(Conflict({ message: 'A channel keeps at least one manager.' }))
      world.update((records) => ({
        ...records,
        groups: records.groups.map((each) => (each.id === group.id ? { ...each, memberIds: people } : each)),
      }))
      world.emit(people, { type: 'group.changed', groupId: group.id })
      return yield* found(
        groupsOf(world.records(), viewerId).find((each) => each.id === group.id),
        'No such group.',
      )
    }),
})

/** An open channel shows to everyone; a private one to the people in its room, and that it exists to an administrator (rule 6). */
const isVisible = (records: Records, viewerId: MemberId, channel: ChannelRecord): boolean =>
  channel.visibility === 'open' ||
  memberById(records, viewerId)?.role === 'admin' ||
  isInRoom(records, viewerId, channel)

const isInRoom = (records: Records, viewerId: MemberId, channel: ChannelRecord): boolean =>
  records.conversations.some(
    (room) => room.id === channel.conversationId && room.participantIds.includes(viewerId),
  )

/** The asker's one conversation with a channel's agent and its managers; only they, the agent and the managers take part (rule 6). */
const privateQuestionOf = (
  world: World,
  askerId: MemberId,
  channel: ChannelRecord,
  agentId: MemberId,
): ConversationRecord => {
  const existing = world
    .records()
    .conversations.find(
      (room) => room.privateQuestionOf?.slug === channel.slug && room.privateQuestionOf.askedBy === askerId,
    )
  if (existing !== undefined) return existing
  const now = world.clock.now()
  const room: ConversationRecord = {
    id: world.nextId('conv') as ConversationId,
    kind: 'group',
    title: null,
    participantIds: [...new Set([askerId, agentId, ...managersOf(world.records(), channel)])],
    createdAt: now,
    lastActivityAt: now,
    mutedBy: [],
    privateQuestionOf: { slug: channel.slug, askedBy: askerId },
  }
  world.update((records) => ({ ...records, conversations: [...records.conversations, room] }))
  return room
}

const channelOf = (records: Records, viewerId: MemberId, slug: string): T.Task<ChannelRecord, ApiError> =>
  found(
    records.channels.find((channel) => channel.slug === slug && isVisible(records, viewerId, channel)),
    'No such channel.',
  )

/** A channel's agent is run, and read, only by the managers of its channel (rule 6). */
export const managedChannel = (
  records: Records,
  viewerId: MemberId,
  slug: string,
): T.Task<ChannelRecord, ApiError> =>
  T.flatMap((channel: ChannelRecord) =>
    managersOf(records, channel).includes(viewerId)
      ? T.succeed(channel)
      : T.fail(NotFound({ message: 'Only the managers of this channel see its agent.' })),
  )(channelOf(records, viewerId, slug))

const seen = (world: World, viewerId: MemberId, slug: string): T.Task<Channel, ApiError> =>
  T.map((channel: ChannelRecord) => channelAsSeen(world.records(), viewerId, channel))(
    channelOf(world.records(), viewerId, slug),
  )

const changeChannel = (
  world: World,
  viewerId: MemberId,
  slug: string,
  change: (records: Records, channel: ChannelRecord) => Records,
): T.Task<Channel, ApiError> =>
  T.gen(function* () {
    const channel = yield* channelOf(world.records(), viewerId, slug)
    world.update((records) => change(records, channel))
    return yield* announced(world, viewerId, slug)
  })

const announced = (world: World, viewerId: MemberId, slug: string): T.Task<Channel, ApiError> =>
  T.map((channel: Channel) => {
    world.emit([viewerId], { type: 'channel.changed', channel })
    return channel
  })(seen(world, viewerId, slug))

const withAnswering = (
  records: Records,
  channel: ChannelRecord,
  memberId: MemberId,
  answering: boolean,
): ReadonlyArray<ChannelRecord> =>
  records.channels.map((each) =>
    each.slug !== channel.slug
      ? each
      : {
          ...each,
          answering: answering
            ? [...each.answering.filter((id) => id !== memberId), memberId]
            : each.answering.filter((id) => id !== memberId),
        },
  )
