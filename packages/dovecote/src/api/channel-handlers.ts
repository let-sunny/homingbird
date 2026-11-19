import { Task as T } from '@homingbird/kernel'
import { type Channel, type Contract, MemberId, type ResponseOf } from '@homingbird/protocol'
import {
  addChannelMember,
  channelMembers,
  grantManager,
  removeChannelMember,
  revokeManager,
  setVisibility,
} from '../domain/channel-membership.ts'
import {
  channelNamed,
  createChannel,
  joinChannel,
  leaveChannel,
  listChannels,
  setAnswering,
} from '../domain/channels.ts'
import { viewerOf } from '../environment.ts'
import { type RequestEnv, announceDirectoryChange } from '../events/events.ts'
import type { Handlers } from './handlers.ts'
import { channelPageSize, identifier } from './route-parameters.ts'

/** Finding, joining and running channels; every change to one tells the directory. */
export const channelHandlers = {
  'channels.list': ({ query }, caller) =>
    listChannels(viewerOf(caller), {
      search: query.q,
      limit: channelPageSize(query.limit),
      offset: Number(query.cursor ?? 0),
    }),
  'channels.get': ({ params }, caller) => channelNamed(viewerOf(caller), params.slug),
  'channels.create': ({ body }, caller) =>
    announcingChannel(caller.member.id, createChannel(viewerOf(caller), body)),
  'channels.join': ({ params, body }, caller) =>
    announcingChannel(caller.member.id, joinChannel(viewerOf(caller), params.slug, body.answering === true)),
  'channels.leave': ({ params }, caller) =>
    announcingChannel(caller.member.id, leaveChannel(viewerOf(caller), params.slug)),
  'channels.answering.on': ({ params }, caller) =>
    announcingChannel(caller.member.id, setAnswering(viewerOf(caller), params.slug, true)),
  'channels.answering.off': ({ params }, caller) =>
    announcingChannel(caller.member.id, setAnswering(viewerOf(caller), params.slug, false)),
  'channels.visibility.set': ({ params, body }, caller) =>
    announcingChannel(caller.member.id, setVisibility(viewerOf(caller), params.slug, body.visibility)),
  'channels.members.list': ({ params }, caller) =>
    T.map((members: Awaited<ResponseOf<Contract['channels.members.list']>>['members']) => ({ members }))(
      channelMembers(viewerOf(caller), params.slug),
    ),
  'channels.members.add': ({ params }, caller) =>
    T.flatMap((memberId: MemberId) =>
      announcingChannel(memberId, addChannelMember(viewerOf(caller), params.slug, memberId)),
    )(identifier(MemberId, params.memberId)),
  'channels.members.remove': ({ params }, caller) =>
    T.flatMap((memberId: MemberId) =>
      announcingChannel(memberId, removeChannelMember(viewerOf(caller), params.slug, memberId)),
    )(identifier(MemberId, params.memberId)),
  'channels.managers.add': ({ params }, caller) =>
    T.flatMap((memberId: MemberId) => grantManager(viewerOf(caller), params.slug, memberId))(
      identifier(MemberId, params.memberId),
    ),
  'channels.managers.remove': ({ params }, caller) =>
    T.flatMap((memberId: MemberId) => revokeManager(viewerOf(caller), params.slug, memberId))(
      identifier(MemberId, params.memberId),
    ),
} satisfies Partial<Handlers>

const announcingChannel = <E>(
  memberId: MemberId,
  change: T.Task<Channel, E, RequestEnv>,
): T.Task<Channel, E, RequestEnv> => T.tap((_: Channel) => announceDirectoryChange(memberId))(change)
