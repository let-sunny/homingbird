import { Task as T } from '@homingbird/kernel'
import {
  type Channel,
  type Contract,
  CredentialId,
  MemberId,
  NoteId,
  type ResponseOf,
} from '@homingbird/protocol'
import {
  channelAgentFor,
  createChannelAgent,
  renameChannelAgent,
  retireChannelAgent,
  revokeAgentCredential,
} from '../domain/channel-agents.ts'
import {
  addChannelMember,
  channelMembers,
  removeChannelMember,
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
import { addTeamToChannel } from '../domain/group-membership.ts'
import { channelAgentInsights } from '../domain/insights.ts'
import { askPrivately } from '../domain/private-questions.ts'
import { reviewFor, reviewsFor } from '../domain/reviews.ts'
import { viewerOf } from '../environment.ts'
import { type RequestEnv, announceDirectoryChange } from '../events/events.ts'
import type { Handlers } from './handlers.ts'
import { channelPageSize, identifier } from './route-parameters.ts'

/** Finding, joining and running channels and their agents; every change to a channel tells the directory. */
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
  'channels.managers.addTeam': ({ params, body }, caller) =>
    announcingChannel(caller.member.id, addTeamToChannel(caller, params.slug, body.groupId)),
  'channels.agent.get': ({ params }, caller) => channelAgentFor(caller, params.slug),
  'channels.agent.create': ({ params, body }, caller) => createChannelAgent(caller, params.slug, body.name),
  'channels.agent.rename': ({ params, body }, caller) => renameChannelAgent(caller, params.slug, body.name),
  'channels.agent.retire': ({ params }, caller) => T.as({})(retireChannelAgent(caller, params.slug)),
  'channels.agent.figures': ({ params }, caller) => channelAgentInsights(caller, params.slug),
  'channels.agent.credentials.revoke': ({ params }, caller) =>
    T.flatMap((id: CredentialId) => revokeAgentCredential(caller, params.slug, id))(
      identifier(CredentialId, params.id),
    ),
  'channels.askPrivately': ({ params }, caller) => askPrivately(caller, params.slug),
  'reviews.list': (_, caller) =>
    T.map((reviews: Awaited<ResponseOf<Contract['reviews.list']>>['reviews']) => ({ reviews }))(
      reviewsFor(caller),
    ),
  'reviews.get': ({ params }, caller) =>
    T.flatMap((id: NoteId) => reviewFor(caller, id))(identifier(NoteId, params.id)),
} satisfies Partial<Handlers>

const announcingChannel = <E>(
  memberId: MemberId,
  change: T.Task<Channel, E, RequestEnv>,
): T.Task<Channel, E, RequestEnv> => T.tap((_: Channel) => announceDirectoryChange(memberId))(change)
