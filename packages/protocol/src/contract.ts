import { Schema as S, type Task } from '@homingbird/kernel'
import { AnalyticsBatch } from './analytics.ts'
import { AgentListing, ChannelAgent, ChannelAgentName, Review } from './channel-agents.ts'
import { CharacterSpec } from './character.ts'
import {
  ConsentRequest,
  DeviceRequest,
  Digits,
  DraftAsShown,
  Empty,
  InboxItem,
  JoinCode,
  Me,
  PageLimit,
  Recipients,
  ServerInfo,
} from './contract-schemas.ts'
import { DraftedResult } from './debate-result.ts'
import {
  DEBATE_INVITEES_MAX,
  DEBATE_TURN_MAX,
  Debate,
  DebateAsk,
  DebateEnded,
  DebateExport,
  DebateExportFormat,
  DebateLimitsWish,
  DebateQuestion,
  DebateSummary,
  DebateVisibility,
  DebateVote,
} from './debates.ts'
import { DeskWake, DeskWakeSetup, DeskWakeTest } from './desk-wake.ts'
import {
  AnsweredFromHistory,
  EARLIER_ANSWERS_MAX,
  EarlierAnswer,
  EarlierAnswersAsk,
} from './earlier-answers.ts'
import type { ApiError } from './errors.ts'
import { StreamEvent } from './events.ts'
import { GROUP_MEMBERS_MAX, Group, GroupName } from './groups.ts'
import { ConversationId, CredentialId, DraftRequestId, GroupId, MemberId, NoteId, Timestamp } from './ids.ts'
import { AgentReport, ChannelAgentReport, OrganizationInsights, PlaceName } from './insights.ts'
import { Invite, InviteEmail, InviteLink } from './invites.ts'
import {
  AgentLabel,
  AnsweringFlowSetting,
  CHANNEL_DESCRIPTION_MAX,
  Channel,
  ChannelMember,
  ChannelSlug,
  ChannelVisibility,
  Contact,
  Conversation,
  Credential,
  DRAFT_INSTRUCTION_MAX,
  DeskUnavailableKind,
  DirectoryEntry,
  DiscardReason,
  DraftRequest,
  type DraftSource,
  DraftSources,
  Locale,
  Member,
  MemberStatus,
  NOTIFICATION_LEVELS,
  Note,
  NoteBasis,
  NoteBody,
  Notice,
  NotificationLevel,
  PROFILE_MAX,
  PublicText,
  RELEASE_REASON_MAX,
  Role,
  Settings,
} from './model.ts'
import {
  DraftingPrinciples,
  MyPrinciples,
  PRINCIPLES_PER_PERSON,
  Principle,
  PrincipleId,
  PrincipleKind,
  PrincipleRule,
  PrincipleSource,
  PrincipleTopic,
} from './principles.ts'
import { type ReadResponseOf, type RequestOf, type Route, route } from './route.ts'
import { DeskSession } from './session-health.ts'

export const PushSubscription = S.struct({
  endpoint: S.string({ minLength: 1, maxLength: 2000, pattern: /^https:\/\// }),
  keys: S.struct({
    p256dh: S.string({ pattern: /^[A-Za-z0-9_-]{80,100}$/ }),
    auth: S.string({ pattern: /^[A-Za-z0-9_-]{16,32}$/ }),
  }),
  locale: S.optional(Locale),
})
export type PushSubscription = S.Infer<typeof PushSubscription>

const ChannelDescription = S.string({ maxLength: CHANNEL_DESCRIPTION_MAX })
const GroupMembers = S.array(MemberId, { maxItems: GROUP_MEMBERS_MAX })

export const contract = {
  'server.info': route({ method: 'GET', path: '/info', access: 'public', response: ServerInfo }),
  'me.get': route({ method: 'GET', path: '/me', access: 'member', response: Me }),
  'me.update': route({
    method: 'PATCH',
    path: '/me',
    access: 'human',
    body: S.struct({
      name: S.optional(S.string({ minLength: 1, maxLength: 200 })),
      profile: S.optional(S.string({ maxLength: PROFILE_MAX })),
      locale: S.optional(S.nullable(Locale)),
    }),
    response: Member,
  }),
  'me.character.set': route({
    method: 'PUT',
    path: '/me/character',
    access: 'human',
    body: CharacterSpec,
    response: Member,
  }),
  'me.character.clear': route({ method: 'DELETE', path: '/me/character', access: 'human', response: Member }),
  'me.notifications.set': route({
    method: 'PUT',
    path: '/me/notifications',
    access: 'human',
    body: S.struct({ notifications: S.literal(...NOTIFICATION_LEVELS) }),
    response: S.struct({ notifications: NotificationLevel }),
  }),
  'me.deskWake.get': route({
    method: 'GET',
    path: '/me/desk-wake',
    access: 'human',
    response: S.struct({ wake: S.nullable(DeskWake) }),
  }),
  'me.deskWake.set': route({
    method: 'PUT',
    path: '/me/desk-wake',
    access: 'human',
    body: DeskWakeSetup,
    response: DeskWake,
  }),
  'me.deskWake.remove': route({ method: 'DELETE', path: '/me/desk-wake', access: 'human', response: Empty }),
  'me.deskWake.test': route({
    method: 'POST',
    path: '/me/desk-wake/test',
    access: 'human',
    body: Empty,
    response: DeskWakeTest,
  }),

  'directory.list': route({
    method: 'GET',
    path: '/directory',
    access: 'member',
    query: {
      q: S.optional(S.string({ maxLength: 200 })),
      channel: S.optional(ChannelSlug),
      group: S.optional(GroupId),
    },
    response: S.struct({ entries: S.array(DirectoryEntry) }),
  }),
  'channels.list': route({
    method: 'GET',
    path: '/channels',
    access: 'member',
    query: {
      q: S.optional(S.string({ maxLength: 200 })),
      limit: S.optional(PageLimit),
      cursor: S.optional(Digits),
    },
    response: S.struct({ channels: S.array(Channel), hasMore: S.boolean, cursor: S.nullable(Digits) }),
  }),
  'channels.get': route({ method: 'GET', path: '/channels/:slug', access: 'member', response: Channel }),
  'channels.create': route({
    method: 'POST',
    path: '/channels',
    access: 'human',
    body: S.struct({
      slug: ChannelSlug,
      description: ChannelDescription,
      visibility: S.optional(ChannelVisibility),
    }),
    response: Channel,
  }),
  'channels.join': route({
    method: 'PUT',
    path: '/channels/:slug/membership',
    access: 'human',
    body: S.struct({ answering: S.optional(S.boolean) }),
    response: Channel,
  }),
  'channels.leave': route({
    method: 'DELETE',
    path: '/channels/:slug/membership',
    access: 'human',
    response: Channel,
  }),
  'channels.answering.on': route({
    method: 'PUT',
    path: '/channels/:slug/answering',
    access: 'human',
    response: Channel,
  }),
  'channels.answering.off': route({
    method: 'DELETE',
    path: '/channels/:slug/answering',
    access: 'human',
    response: Channel,
  }),
  'channels.members.list': route({
    method: 'GET',
    path: '/channels/:slug/members',
    access: 'member',
    response: S.struct({ members: S.array(ChannelMember) }),
  }),
  'channels.members.add': route({
    method: 'PUT',
    path: '/channels/:slug/members/:memberId',
    access: 'human',
    response: Channel,
  }),
  'channels.members.remove': route({
    method: 'DELETE',
    path: '/channels/:slug/members/:memberId',
    access: 'human',
    response: Channel,
  }),
  'channels.managers.addTeam': route({
    method: 'PUT',
    path: '/channels/:slug/managers/team',
    access: 'human',
    body: S.struct({ groupId: GroupId }),
    response: Channel,
  }),
  'channels.agent.get': route({
    method: 'GET',
    path: '/channels/:slug/agent',
    access: 'human',
    response: ChannelAgent,
  }),
  'channels.agent.create': route({
    method: 'PUT',
    path: '/channels/:slug/agent',
    access: 'human',
    body: S.struct({ name: ChannelAgentName }),
    response: ChannelAgent,
  }),
  'channels.agent.rename': route({
    method: 'PATCH',
    path: '/channels/:slug/agent',
    access: 'human',
    body: S.struct({ name: ChannelAgentName }),
    response: ChannelAgent,
  }),
  'channels.agent.retire': route({
    method: 'DELETE',
    path: '/channels/:slug/agent',
    access: 'human',
    response: Empty,
  }),
  'channels.agent.credentials.revoke': route({
    method: 'DELETE',
    path: '/channels/:slug/agent/credentials/:id',
    access: 'human',
    response: ChannelAgent,
  }),
  'channels.agent.figures': route({
    method: 'GET',
    path: '/channels/:slug/agent/figures',
    access: 'human',
    response: ChannelAgentReport,
  }),
  'channels.askPrivately': route({
    method: 'POST',
    path: '/channels/:slug/private-question',
    access: 'human',
    response: Conversation,
  }),
  'reviews.list': route({
    method: 'GET',
    path: '/reviews',
    access: 'human',
    response: S.struct({ reviews: S.array(Review) }),
  }),
  'reviews.get': route({ method: 'GET', path: '/reviews/:id', access: 'human', response: Review }),

  'groups.list': route({
    method: 'GET',
    path: '/groups',
    access: 'member',
    response: S.struct({ groups: S.array(Group) }),
  }),
  'groups.get': route({ method: 'GET', path: '/groups/:id', access: 'member', response: Group }),
  'groups.rename': route({
    method: 'PATCH',
    path: '/groups/:id',
    access: 'human',
    body: S.struct({ name: GroupName }),
    response: Group,
  }),
  'groups.members.set': route({
    method: 'PUT',
    path: '/groups/:id/members',
    access: 'human',
    body: S.struct({ memberIds: GroupMembers }),
    response: Group,
  }),

  'contacts.list': route({
    method: 'GET',
    path: '/contacts',
    access: 'human',
    response: S.struct({ contacts: S.array(Contact), blocked: S.array(MemberId) }),
  }),
  'contacts.request': route({
    method: 'POST',
    path: '/contacts',
    access: 'human',
    body: S.struct({ memberId: MemberId }),
    response: Contact,
  }),
  'contacts.accept': route({
    method: 'POST',
    path: '/contacts/:memberId/accept',
    access: 'human',
    response: Contact,
  }),
  'contacts.remove': route({
    method: 'DELETE',
    path: '/contacts/:memberId',
    access: 'human',
    response: Empty,
  }),
  'blocks.add': route({ method: 'PUT', path: '/blocks/:memberId', access: 'human', response: Empty }),
  'blocks.remove': route({ method: 'DELETE', path: '/blocks/:memberId', access: 'human', response: Empty }),

  'conversations.list': route({
    method: 'GET',
    path: '/conversations',
    access: 'member',
    response: S.struct({ conversations: S.array(Conversation) }),
  }),
  'conversations.create': route({
    method: 'POST',
    path: '/conversations',
    access: 'human',
    body: S.struct({
      participantIds: Recipients,
      title: S.optional(S.string({ minLength: 1, maxLength: 200 })),
    }),
    response: Conversation,
  }),
  'conversations.get': route({
    method: 'GET',
    path: '/conversations/:id',
    access: 'member',
    response: Conversation,
  }),
  'conversations.mute': route({
    method: 'PUT',
    path: '/conversations/:id/mute',
    access: 'human',
    response: Conversation,
  }),
  'conversations.unmute': route({
    method: 'DELETE',
    path: '/conversations/:id/mute',
    access: 'human',
    response: Conversation,
  }),
  'conversations.notes': route({
    method: 'GET',
    path: '/conversations/:id/notes',
    access: 'member',
    query: { before: S.optional(Digits), limit: S.optional(PageLimit) },
    response: S.struct({ notes: S.array(Note), hasMore: S.boolean, notices: S.array(Notice) }),
  }),
  'notes.get': route({ method: 'GET', path: '/notes/:id', access: 'member', response: Note }),
  'notes.read': route({ method: 'POST', path: '/notes/:id/read', access: 'human', response: Note }),
  'notes.pickup': route({ method: 'POST', path: '/notes/:id/pickup', access: 'member', response: Note }),
  'notes.release': route({
    method: 'POST',
    path: '/notes/:id/release',
    access: 'member',
    body: S.struct({ reason: S.optional(S.string({ maxLength: RELEASE_REASON_MAX })) }),
    response: Note,
  }),
  'inbox.list': route({
    method: 'GET',
    path: '/inbox',
    access: 'member',
    query: { fresh: S.optional(S.literal('1')) },
    response: S.struct({ items: S.array(InboxItem) }),
  }),
  'search.notes': route({
    method: 'GET',
    path: '/search',
    access: 'member',
    query: { q: S.string({ minLength: 1, maxLength: 200 }), limit: S.optional(PageLimit) },
    response: S.struct({ notes: S.array(Note) }),
  }),
  'answers.earlier': route({
    method: 'POST',
    path: '/answers/earlier',
    access: 'member',
    body: EarlierAnswersAsk,
    response: S.struct({ answers: S.array(EarlierAnswer, { maxItems: EARLIER_ANSWERS_MAX }) }),
  }),
  'answers.used': route({
    method: 'POST',
    path: '/answers/:id/used',
    access: 'human',
    body: AnsweredFromHistory,
    response: Empty,
  }),

  'drafts.list': route({
    method: 'GET',
    path: '/drafts',
    access: 'member',
    response: S.struct({ drafts: S.array(Note) }),
  }),
  'drafts.create': route({
    method: 'POST',
    path: '/drafts',
    access: 'member',
    body: S.struct({
      body: NoteBody,
      conversationId: S.optional(ConversationId),
      to: S.optional(Recipients),
      channel: S.optional(ChannelSlug),
      inReplyTo: S.optional(NoteId),
      requestId: S.optional(DraftRequestId),
      basis: S.optional(NoteBasis),
      sources: S.optional(DraftSources),
      client: S.optional(AgentLabel),
      model: S.optional(AgentLabel),
      session: S.optional(DeskSession),
    }),
    response: Note,
  }),
  'drafts.update': route({
    method: 'PATCH',
    path: '/drafts/:id',
    access: 'member',
    body: S.refine(
      'a new body or channel',
      (change: {
        readonly body?: string
        readonly channel?: string
        readonly basis?: string
        readonly sources?: ReadonlyArray<DraftSource>
        readonly model?: string
      }) =>
        change.body !== undefined ||
        change.channel !== undefined ||
        change.basis !== undefined ||
        change.sources !== undefined ||
        change.model !== undefined,
      'Give a new body, a new channel, a new basis, new sources, a model, or several.',
    )(
      S.struct({
        body: S.optional(NoteBody),
        channel: S.optional(ChannelSlug),
        basis: S.optional(NoteBasis),
        sources: S.optional(DraftSources),
        model: S.optional(AgentLabel),
      }),
    ),
    response: Note,
  }),
  'drafts.send': route({
    method: 'POST',
    path: '/drafts/:id/send',
    access: 'human',
    body: S.struct({
      body: S.optional(NoteBody),
      expected: DraftAsShown,
    }),
    response: Note,
  }),
  'drafts.discard': route({
    method: 'POST',
    path: '/drafts/:id/discard',
    access: 'human',
    body: S.struct({ reason: S.optional(DiscardReason) }),
    response: Note,
  }),
  'drafts.seen': route({
    method: 'POST',
    path: '/drafts/:id/seen',
    access: 'human',
    response: Empty,
  }),

  'insights.mine': route({
    method: 'GET',
    path: '/insights/me',
    access: 'human',
    response: AgentReport,
  }),

  'principles.list': route({
    method: 'GET',
    path: '/principles',
    access: 'human',
    response: MyPrinciples,
  }),
  'principles.create': route({
    method: 'POST',
    path: '/principles',
    access: 'human',
    body: S.struct({
      kind: S.optional(PrincipleKind),
      topic: PrincipleTopic,
      rule: PrincipleRule,
      source: S.optional(S.nullable(PrincipleSource)),
      place: PlaceName,
      publicText: S.optional(S.nullable(PublicText)),
      offerId: S.optional(S.string({ maxLength: 64 })),
      confirmed: S.optional(S.boolean),
    }),
    response: Principle,
  }),
  'principles.update': route({
    method: 'PATCH',
    path: '/principles/:id',
    access: 'human',
    body: S.struct({
      kind: S.optional(PrincipleKind),
      topic: S.optional(PrincipleTopic),
      rule: S.optional(PrincipleRule),
      source: S.optional(S.nullable(PrincipleSource)),
      enabled: S.optional(S.boolean),
      publicText: S.optional(S.nullable(PublicText)),
    }),
    response: Principle,
  }),
  'principles.reorder': route({
    method: 'PUT',
    path: '/principles/order',
    access: 'human',
    body: S.struct({ ids: S.array(PrincipleId, { maxItems: PRINCIPLES_PER_PERSON }) }),
    response: MyPrinciples,
  }),
  'principles.delete': route({
    method: 'DELETE',
    path: '/principles/:id',
    access: 'human',
    response: Principle,
  }),
  'principles.miss': route({
    method: 'POST',
    path: '/principles/:id/misses',
    access: 'human',
    body: S.struct({ noteId: NoteId }),
    response: Principle,
  }),
  'principles.offers.dismiss': route({
    method: 'POST',
    path: '/principle-offers/:id/dismiss',
    access: 'human',
    body: S.struct({ stopAskingHere: S.optional(S.boolean) }),
    response: Empty,
  }),
  'principles.drafting': route({
    method: 'GET',
    path: '/principles/drafting',
    access: 'member',
    query: { conversationId: S.optional(ConversationId) },
    response: DraftingPrinciples,
  }),

  'draftRequests.list': route({
    method: 'GET',
    path: '/draft-requests',
    access: 'member',
    response: S.struct({ requests: S.array(DraftRequest) }),
  }),
  'draftRequests.create': route({
    method: 'POST',
    path: '/draft-requests',
    access: 'human',
    body: S.struct({
      conversationId: S.optional(ConversationId),
      to: S.optional(Recipients),
      channel: S.optional(ChannelSlug),
      inReplyTo: S.optional(NoteId),
      instruction: S.optional(S.string({ maxLength: DRAFT_INSTRUCTION_MAX })),
      agentId: S.optional(CredentialId),
    }),
    response: DraftRequest,
  }),
  'draftRequests.cancel': route({
    method: 'POST',
    path: '/draft-requests/:id/cancel',
    access: 'human',
    response: DraftRequest,
  }),

  'debates.list': route({
    method: 'GET',
    path: '/debates',
    access: 'member',
    response: S.struct({ debates: S.array(DebateSummary) }),
  }),
  'debates.waiting': route({
    method: 'GET',
    path: '/debate-asks',
    access: 'member',
    response: S.struct({
      asks: S.array(DebateAsk),
      /** Rooms whose drafts of the result this agent is asked to vote on. */
      ballots: S.optional(S.array(Debate)),
      /** Rooms of this agent that closed as they were, without a result, in the last day. */
      ended: S.optional(S.array(DebateEnded)),
    }),
  }),
  'debates.get': route({
    method: 'GET',
    path: '/debates/:id',
    access: 'member',
    response: Debate,
  }),
  'debates.create': route({
    method: 'POST',
    path: '/debates',
    access: 'human',
    body: S.struct({
      question: DebateQuestion,
      visibility: S.optional(DebateVisibility),
      limits: S.optional(DebateLimitsWish),
      memberIds: S.optional(S.array(MemberId, { maxItems: DEBATE_INVITEES_MAX })),
    }),
    response: Debate,
  }),
  'debates.optIn': route({
    method: 'PUT',
    path: '/debates/:id/agent',
    access: 'human',
    body: S.struct({ agentId: CredentialId }),
    response: Debate,
  }),
  'debates.limits.set': route({
    method: 'PUT',
    path: '/debates/:id/limits',
    access: 'human',
    body: DebateLimitsWish,
    response: Debate,
  }),
  'debates.turns.post': route({
    method: 'POST',
    path: '/debates/:id/turns',
    access: 'member',
    body: S.struct({
      body: S.string({ minLength: 1, maxLength: DEBATE_TURN_MAX }),
      model: S.optional(AgentLabel),
      /** The last turn the agent read: a room that moved past it answers 409 and saves nothing. */
      afterTurn: S.optional(S.int({ min: 0 })),
    }),
    response: Debate,
  }),
  'debates.result.draft': route({
    method: 'PUT',
    path: '/debates/:id/result',
    access: 'member',
    body: DraftedResult,
    response: Debate,
  }),
  'debates.result.vote': route({
    method: 'POST',
    path: '/debates/:id/result/vote',
    access: 'member',
    body: DebateVote,
    response: Debate,
  }),
  'debates.result.post': route({
    method: 'POST',
    path: '/debates/:id/result/post',
    access: 'human',
    body: S.struct({
      conversationId: S.optional(ConversationId),
      to: S.optional(MemberId),
      channel: S.optional(ChannelSlug),
    }),
    response: Note,
  }),
  'debates.export': route({
    method: 'POST',
    path: '/debates/:id/export',
    access: 'human',
    body: S.struct({ format: DebateExportFormat, language: S.optional(Locale) }),
    response: DebateExport,
  }),

  'credentials.list': route({
    method: 'GET',
    path: '/credentials',
    access: 'human',
    response: S.struct({ credentials: S.array(Credential) }),
  }),
  'credentials.rename': route({
    method: 'PATCH',
    path: '/credentials/:id',
    access: 'human',
    body: S.struct({ name: S.string({ minLength: 1, maxLength: 200 }) }),
    response: Credential,
  }),
  'credentials.revoke': route({
    method: 'DELETE',
    path: '/credentials/:id',
    access: 'human',
    response: Empty,
  }),
  'device.get': route({ method: 'GET', path: '/device/:userCode', access: 'human', response: DeviceRequest }),
  'device.decide': route({
    method: 'POST',
    path: '/device/:userCode',
    access: 'human',
    body: S.struct({
      approve: S.boolean,
      name: S.optional(S.string({ minLength: 1, maxLength: 200 })),
      /** Issues the credential to this channel's agent instead of the person deciding. */
      channel: S.optional(ChannelSlug),
    }),
    response: Empty,
  }),
  'joinCodes.create': route({
    method: 'POST',
    path: '/join-codes',
    access: 'human',
    body: S.struct({
      /** Issues the credential to this channel's agent instead of the person creating the code. */
      channel: S.optional(ChannelSlug),
    }),
    response: JoinCode,
  }),
  'invites.list': route({
    method: 'GET',
    path: '/invites',
    access: 'human',
    response: S.struct({ invites: S.array(Invite) }),
  }),
  'invites.create': route({
    method: 'POST',
    path: '/invites',
    access: 'human',
    body: S.struct({
      /** Admits only this address; without it, whoever opens the link first. */
      email: S.optional(InviteEmail),
    }),
    response: InviteLink,
  }),
  'invites.revoke': route({ method: 'DELETE', path: '/invites/:id', access: 'human', response: Empty }),
  'consent.get': route({ method: 'GET', path: '/consent/:id', access: 'human', response: ConsentRequest }),
  'consent.decide': route({
    method: 'POST',
    path: '/consent/:id',
    access: 'human',
    body: S.struct({ approve: S.boolean, name: S.optional(S.string({ minLength: 1, maxLength: 200 })) }),
    response: S.struct({ redirectTo: S.string() }),
  }),

  'push.key': route({
    method: 'GET',
    path: '/push/key',
    access: 'member',
    response: S.struct({ publicKey: S.string() }),
  }),
  'push.subscribe': route({
    method: 'POST',
    path: '/push/subscriptions',
    access: 'human',
    body: PushSubscription,
    response: Empty,
  }),
  'presence.visibility': route({
    method: 'POST',
    path: '/presence/visibility',
    access: 'human',
    body: S.struct({ page: S.string({ pattern: /^[A-Za-z0-9-]{8,64}$/ }), visible: S.boolean }),
    response: Empty,
  }),
  /**
   * Answers nothing and changes nothing but the credential's last use: a client holding an event stream
   * sends it every minute, since a held stream alone does not show that its agent is taking part.
   */
  'presence.heartbeat': route({
    method: 'GET',
    path: '/presence/heartbeat',
    access: 'member',
    response: Empty,
  }),
  /** A running desk says its agent cannot answer now; colleagues see only that, and until when. */
  'me.desk.unavailable': route({
    method: 'POST',
    path: '/me/desk/unavailable',
    access: 'member',
    body: S.struct({ kind: DeskUnavailableKind, until: S.optional(Timestamp) }),
    response: Empty,
  }),
  'me.desk.available': route({
    method: 'POST',
    path: '/me/desk/available',
    access: 'member',
    body: Empty,
    response: Empty,
  }),
  'push.test': route({
    method: 'POST',
    path: '/push/test',
    access: 'human',
    body: Empty,
    response: S.struct({
      results: S.array(S.struct({ endpointHost: S.string(), status: S.int({ min: 0 }), removed: S.boolean })),
    }),
  }),
  'push.unsubscribe': route({
    method: 'POST',
    path: '/push/subscriptions/remove',
    access: 'human',
    body: S.struct({ endpoint: S.string({ minLength: 1, maxLength: 2000 }) }),
    response: Empty,
  }),
  'analytics.track': route({
    method: 'POST',
    path: '/analytics/events',
    access: 'member',
    body: AnalyticsBatch,
    response: Empty,
  }),
  'events.poll': route({
    method: 'GET',
    path: '/events/poll',
    access: 'member',
    query: { after: S.optional(Digits), wait: S.optional(S.string({ pattern: /^[0-9]{1,2}$/ })) },
    response: S.struct({ events: S.array(StreamEvent), cursor: S.int({ min: 0 }) }),
  }),

  'answeringFlow.get': route({
    method: 'GET',
    path: '/answering-flow',
    access: 'member',
    response: AnsweringFlowSetting,
  }),
  'admin.settings.get': route({
    method: 'GET',
    path: '/admin/settings',
    access: 'admin',
    response: Settings,
  }),
  'admin.settings.put': route({
    method: 'PUT',
    path: '/admin/settings',
    access: 'admin',
    body: Settings,
    response: Settings,
  }),
  'admin.members.list': route({
    method: 'GET',
    path: '/admin/members',
    access: 'admin',
    response: S.struct({ members: S.array(Member), agents: S.optional(S.array(AgentListing)) }),
  }),
  'admin.members.update': route({
    method: 'PATCH',
    path: '/admin/members/:id',
    access: 'admin',
    body: S.struct({ status: S.optional(MemberStatus), role: S.optional(Role) }),
    response: Member,
  }),
  'admin.members.resetCharacter': route({
    method: 'DELETE',
    path: '/admin/members/:id/character',
    access: 'admin',
    response: Member,
  }),
  'admin.channels.update': route({
    method: 'PATCH',
    path: '/admin/channels/:slug',
    access: 'admin',
    body: S.struct({ slug: S.optional(ChannelSlug), description: S.optional(ChannelDescription) }),
    response: Channel,
  }),
  'admin.channels.archive': route({
    method: 'POST',
    path: '/admin/channels/:slug/archive',
    access: 'admin',
    body: S.struct({ moveMembersTo: S.optional(ChannelSlug) }),
    response: Empty,
  }),
  'admin.groups.create': route({
    method: 'POST',
    path: '/admin/groups',
    access: 'admin',
    body: S.struct({ name: GroupName, memberIds: S.optional(GroupMembers) }),
    response: Group,
  }),
  'admin.groups.delete': route({
    method: 'DELETE',
    path: '/admin/groups/:id',
    access: 'admin',
    response: Empty,
  }),
  'admin.insights': route({
    method: 'GET',
    path: '/admin/insights',
    access: 'admin',
    response: OrganizationInsights,
  }),
} as const satisfies Readonly<Record<string, Route>>

export type Contract = typeof contract
export type RouteName = keyof Contract

export type Api = {
  readonly [N in RouteName]: (
    request: RequestOf<Contract[N]>,
  ) => Task.Task<ReadResponseOf<Contract[N]>, ApiError>
}

export const humanOnlyRoutes = (Object.keys(contract) as RouteName[]).filter(
  (name) => contract[name].access === 'human' || contract[name].access === 'admin',
)
