import { Schema as S, type Task } from '@homingbird/kernel'
import { CharacterSpec } from './character.ts'
import {
  ConsentRequest,
  DeviceRequest,
  Digits,
  Empty,
  InboxItem,
  Me,
  PageLimit,
  Recipients,
  ServerInfo,
} from './contract-schemas.ts'
import type { ApiError } from './errors.ts'
import { StreamEvent } from './events.ts'
import { ConversationId, CredentialId, DraftRequestId, MemberId, NoteId } from './ids.ts'
import {
  AuditEntry,
  Contact,
  Conversation,
  Credential,
  DRAFT_INSTRUCTION_MAX,
  DirectoryEntry,
  DraftRequest,
  Locale,
  Member,
  MemberStatus,
  Note,
  NoteBody,
  PROFILE_MAX,
  Role,
  Settings,
  TOPIC_DESCRIPTION_MAX,
  Topic,
  TopicSlug,
} from './model.ts'
import { type RequestOf, type ResponseOf, type Route, route } from './route.ts'

export const PushSubscription = S.struct({
  endpoint: S.string({ minLength: 1, maxLength: 2000, pattern: /^https:\/\// }),
  keys: S.struct({
    p256dh: S.string({ pattern: /^[A-Za-z0-9_-]{80,100}$/ }),
    auth: S.string({ pattern: /^[A-Za-z0-9_-]{16,32}$/ }),
  }),
  locale: S.optional(Locale),
})
export type PushSubscription = S.Infer<typeof PushSubscription>

const TopicDescription = S.string({ minLength: 1, maxLength: TOPIC_DESCRIPTION_MAX })

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

  'directory.list': route({
    method: 'GET',
    path: '/directory',
    access: 'member',
    query: { q: S.optional(S.string({ maxLength: 200 })), topic: S.optional(TopicSlug) },
    response: S.struct({ entries: S.array(DirectoryEntry) }),
  }),
  'topics.list': route({
    method: 'GET',
    path: '/topics',
    access: 'member',
    query: { q: S.optional(S.string({ maxLength: 200 })) },
    response: S.struct({ topics: S.array(Topic) }),
  }),
  'topics.create': route({
    method: 'POST',
    path: '/topics',
    access: 'human',
    body: S.struct({ slug: TopicSlug, description: TopicDescription }),
    response: Topic,
  }),
  'topics.help': route({ method: 'PUT', path: '/topics/:slug/helpers/me', access: 'human', response: Topic }),
  'topics.leave': route({
    method: 'DELETE',
    path: '/topics/:slug/helpers/me',
    access: 'human',
    response: Topic,
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
  'conversations.notes': route({
    method: 'GET',
    path: '/conversations/:id/notes',
    access: 'member',
    query: { before: S.optional(Digits), limit: S.optional(PageLimit) },
    response: S.struct({ notes: S.array(Note), hasMore: S.boolean }),
  }),
  'notes.get': route({ method: 'GET', path: '/notes/:id', access: 'member', response: Note }),
  'notes.read': route({ method: 'POST', path: '/notes/:id/read', access: 'human', response: Note }),
  'notes.move': route({
    method: 'POST',
    path: '/notes/:id/move',
    access: 'human',
    body: S.struct({ topic: TopicSlug }),
    response: Note,
  }),
  'notes.pickup': route({ method: 'POST', path: '/notes/:id/pickup', access: 'member', response: Note }),
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
      topic: S.optional(TopicSlug),
      inReplyTo: S.optional(NoteId),
      requestId: S.optional(DraftRequestId),
    }),
    response: Note,
  }),
  'drafts.update': route({
    method: 'PATCH',
    path: '/drafts/:id',
    access: 'member',
    body: S.refine(
      'a new body or topic',
      (change: { readonly body?: string; readonly topic?: string }) =>
        change.body !== undefined || change.topic !== undefined,
      'Give a new body, a new topic, or both.',
    )(S.struct({ body: S.optional(NoteBody), topic: S.optional(TopicSlug) })),
    response: Note,
  }),
  'drafts.send': route({
    method: 'POST',
    path: '/drafts/:id/send',
    access: 'human',
    body: S.struct({ body: S.optional(NoteBody) }),
    response: Note,
  }),
  'drafts.discard': route({ method: 'POST', path: '/drafts/:id/discard', access: 'human', response: Note }),

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
      topic: S.optional(TopicSlug),
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
      allowApproval: S.optional(S.boolean),
    }),
    response: Empty,
  }),
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
  'push.unsubscribe': route({
    method: 'POST',
    path: '/push/subscriptions/remove',
    access: 'human',
    body: S.struct({ endpoint: S.string({ minLength: 1, maxLength: 2000 }) }),
    response: Empty,
  }),
  'events.poll': route({
    method: 'GET',
    path: '/events/poll',
    access: 'member',
    query: { after: S.optional(Digits), wait: S.optional(S.string({ pattern: /^[0-9]{1,2}$/ })) },
    response: S.struct({ events: S.array(StreamEvent), cursor: S.int({ min: 0 }) }),
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
    response: S.struct({ members: S.array(Member) }),
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
  'admin.topics.update': route({
    method: 'PATCH',
    path: '/admin/topics/:slug',
    access: 'admin',
    body: S.struct({ slug: S.optional(TopicSlug), description: S.optional(TopicDescription) }),
    response: Topic,
  }),
  'admin.topics.remove': route({
    method: 'DELETE',
    path: '/admin/topics/:slug',
    access: 'admin',
    response: Empty,
  }),
  'admin.topics.merge': route({
    method: 'POST',
    path: '/admin/topics/:slug/merge',
    access: 'admin',
    body: S.struct({ into: TopicSlug }),
    response: Topic,
  }),
  'admin.audit.list': route({
    method: 'GET',
    path: '/admin/audit',
    access: 'admin',
    query: {
      before: S.optional(Digits),
      limit: S.optional(PageLimit),
      actorId: S.optional(MemberId),
      action: S.optional(S.string({ maxLength: 100 })),
    },
    response: S.struct({ entries: S.array(AuditEntry), hasMore: S.boolean }),
  }),
} as const satisfies Readonly<Record<string, Route>>

export type Contract = typeof contract
export type RouteName = keyof Contract

export type Api = {
  readonly [N in RouteName]: (request: RequestOf<Contract[N]>) => Task.Task<ResponseOf<Contract[N]>, ApiError>
}

export const humanOnlyRoutes = (Object.keys(contract) as RouteName[]).filter(
  (name) => contract[name].access === 'human' || contract[name].access === 'admin',
)
