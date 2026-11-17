/**
 * The API contract: every JSON endpoint, declared once.
 *
 * The server's router and the typed client are both derived from this table, so a route's path
 * parameters, query, body, response and required access cannot drift between the two. The
 * `access` column is the first line of the security rules: `human` routes refuse agent
 * credentials before any handler runs.
 */
import { Schema as S, type Simplify } from '@homingbird/kernel'
import { StreamEvent } from './events.ts'
import { ConversationId, CredentialId, MemberId, NoteId } from './ids.ts'
import {
  AuditEntry,
  Contact,
  ContactMode,
  Conversation,
  Credential,
  CredentialKind,
  DirectoryEntry,
  Member,
  MemberStatus,
  Note,
  NoteBody,
  PROFILE_MAX,
  Role,
  Settings,
} from './model.ts'
import type { Access } from './policy.ts'

export const API_PREFIX = '/api/v1'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface Route<
  M extends Method = Method,
  P extends string = string,
  Q extends S.Fields | undefined = S.Fields | undefined,
  B extends S.Schema<any> | undefined = S.Schema<any> | undefined,
  R extends S.Schema<any> = S.Schema<any>,
> {
  readonly method: M
  readonly path: P
  readonly access: Access
  readonly query: Q
  readonly body: B
  readonly response: R
}

const route = <
  M extends Method,
  P extends string,
  R extends S.Schema<any>,
  Q extends S.Fields | undefined = undefined,
  B extends S.Schema<any> | undefined = undefined,
>(def: {
  method: M
  path: P
  access: Access
  response: R
  query?: Q
  body?: B
}): Route<M, P, Q, B, R> => ({
  method: def.method,
  path: def.path,
  access: def.access,
  query: def.query as Q,
  body: def.body as B,
  response: def.response,
})

/** `'/notes/:id/x/:y'` -> `{ id: string; y: string }` */
export type PathParams<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? { readonly [K in Param]: string } & PathParams<`/${Rest}`>
  : P extends `${string}:${infer Param}`
    ? { readonly [K in Param]: string }
    : {}

/** What a caller supplies for a route: only the parts the route declares. */
export type RequestOf<R extends Route> = Simplify<
  (keyof PathParams<R['path']> extends never ? {} : { readonly params: Simplify<PathParams<R['path']>> }) &
    (R['query'] extends S.Fields ? { readonly query: S.InferFields<R['query']> } : {}) &
    (R['body'] extends S.Schema<infer B> ? { readonly body: B } : {})
>

export type ResponseOf<R extends Route> = S.Infer<R['response']>

const Empty = S.struct({})
const digits = S.string({ pattern: /^[0-9]{1,15}$/ })
const limit = S.string({ pattern: /^[0-9]{1,3}$/ })

const Recipients = S.array(MemberId, { minItems: 1, maxItems: 50 })

/** A note awaiting the caller's reply, with what an agent needs to quote it safely. */
export const InboxItem = S.struct({ note: Note, author: Member, conversation: Conversation })
export type InboxItem = S.Infer<typeof InboxItem>

export const DeviceRequest = S.struct({
  userCode: S.string(),
  client: S.string(),
  /** True when the client also asked for an approval credential for its approve button. */
  wantsApproval: S.boolean,
  expiresAt: S.int({ min: 0 }),
})
export type DeviceRequest = S.Infer<typeof DeviceRequest>

export const ConsentRequest = S.struct({
  id: S.string(),
  client: S.string(),
  redirectHost: S.string(),
  expiresAt: S.int({ min: 0 }),
})
export type ConsentRequest = S.Infer<typeof ConsentRequest>

export const ServerInfo = S.struct({
  name: S.literal('dovecote'),
  version: S.string(),
  contactMode: ContactMode,
  /** Label for the sign-in button, e.g. "Google". */
  signInWith: S.string(),
})
export type ServerInfo = S.Infer<typeof ServerInfo>

export const Me = S.struct({
  member: Member,
  credential: S.struct({ id: CredentialId, kind: CredentialKind, name: S.string() }),
  contactMode: ContactMode,
})
export type Me = S.Infer<typeof Me>

export const contract = {
  // -- Server and session ---------------------------------------------------------------------
  'server.info': route({ method: 'GET', path: '/info', access: 'public', response: ServerInfo }),
  'me.get': route({ method: 'GET', path: '/me', access: 'member', response: Me }),
  'me.update': route({
    method: 'PATCH',
    path: '/me',
    access: 'human',
    body: S.struct({
      name: S.optional(S.string({ minLength: 1, maxLength: 200 })),
      profile: S.optional(S.string({ maxLength: PROFILE_MAX })),
    }),
    response: Member,
  }),

  // -- Directory, contacts, blocks ------------------------------------------------------------
  'directory.list': route({
    method: 'GET',
    path: '/directory',
    access: 'member',
    query: { q: S.optional(S.string({ maxLength: 200 })) },
    response: S.struct({ entries: S.array(DirectoryEntry) }),
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
  'contacts.accept': route({ method: 'POST', path: '/contacts/:memberId/accept', access: 'human', response: Contact }),
  'contacts.remove': route({ method: 'DELETE', path: '/contacts/:memberId', access: 'human', response: Empty }),
  'blocks.add': route({ method: 'PUT', path: '/blocks/:memberId', access: 'human', response: Empty }),
  'blocks.remove': route({ method: 'DELETE', path: '/blocks/:memberId', access: 'human', response: Empty }),

  // -- Conversations and notes ----------------------------------------------------------------
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
    body: S.struct({ participantIds: Recipients, title: S.optional(S.string({ minLength: 1, maxLength: 200 })) }),
    response: Conversation,
  }),
  'conversations.get': route({ method: 'GET', path: '/conversations/:id', access: 'member', response: Conversation }),
  'conversations.notes': route({
    method: 'GET',
    path: '/conversations/:id/notes',
    access: 'member',
    query: { before: S.optional(digits), limit: S.optional(limit) },
    /** Sent notes plus the caller's own drafts, oldest first. */
    response: S.struct({ notes: S.array(Note), hasMore: S.boolean }),
  }),
  'notes.get': route({ method: 'GET', path: '/notes/:id', access: 'member', response: Note }),
  /** The caller's human opened the note. */
  'notes.read': route({ method: 'POST', path: '/notes/:id/read', access: 'human', response: Note }),
  /** An agent took the note to draft a reply; shown to everyone as "drafting reply". */
  'notes.pickup': route({ method: 'POST', path: '/notes/:id/pickup', access: 'member', response: Note }),
  'inbox.list': route({
    method: 'GET',
    path: '/inbox',
    access: 'member',
    /** `fresh=1` leaves out notes the calling credential has already picked up. */
    query: { fresh: S.optional(S.literal('1')) },
    response: S.struct({ items: S.array(InboxItem) }),
  }),
  'search.notes': route({
    method: 'GET',
    path: '/search',
    access: 'member',
    query: { q: S.string({ minLength: 1, maxLength: 200 }), limit: S.optional(limit) },
    response: S.struct({ notes: S.array(Note) }),
  }),

  // -- Drafts and approval --------------------------------------------------------------------
  'drafts.list': route({ method: 'GET', path: '/drafts', access: 'member', response: S.struct({ drafts: S.array(Note) }) }),
  'drafts.create': route({
    method: 'POST',
    path: '/drafts',
    access: 'member',
    /** Address a draft by conversation, by recipients, or by the note it replies to. */
    body: S.struct({
      body: NoteBody,
      conversationId: S.optional(ConversationId),
      to: S.optional(Recipients),
      inReplyTo: S.optional(NoteId),
    }),
    response: Note,
  }),
  'drafts.update': route({
    method: 'PATCH',
    path: '/drafts/:id',
    access: 'member',
    body: S.struct({ body: NoteBody }),
    response: Note,
  }),
  /** Approval. Human credentials only; optionally replaces the body first ("edit then send"). */
  'drafts.send': route({
    method: 'POST',
    path: '/drafts/:id/send',
    access: 'human',
    body: S.struct({ body: S.optional(NoteBody) }),
    response: Note,
  }),
  'drafts.discard': route({ method: 'POST', path: '/drafts/:id/discard', access: 'human', response: Note }),

  // -- Credentials ----------------------------------------------------------------------------
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
  'credentials.revoke': route({ method: 'DELETE', path: '/credentials/:id', access: 'human', response: Empty }),
  'device.get': route({ method: 'GET', path: '/device/:userCode', access: 'human', response: DeviceRequest }),
  'device.decide': route({
    method: 'POST',
    path: '/device/:userCode',
    access: 'human',
    body: S.struct({
      approve: S.boolean,
      name: S.optional(S.string({ minLength: 1, maxLength: 200 })),
      /** Grant the approval credential the client asked for. Ignored unless it asked. */
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
    /** Where the browser must go next to finish the OAuth flow. */
    response: S.struct({ redirectTo: S.string() }),
  }),

  // -- Events (long-poll fallback; SSE and WebSocket are not JSON routes) ----------------------
  'events.poll': route({
    method: 'GET',
    path: '/events/poll',
    access: 'member',
    query: { after: S.optional(digits), wait: S.optional(S.string({ pattern: /^[0-9]{1,2}$/ })) },
    response: S.struct({ events: S.array(StreamEvent), cursor: S.int({ min: 0 }) }),
  }),

  // -- Administration -------------------------------------------------------------------------
  'admin.settings.get': route({ method: 'GET', path: '/admin/settings', access: 'admin', response: Settings }),
  'admin.settings.put': route({ method: 'PUT', path: '/admin/settings', access: 'admin', body: Settings, response: Settings }),
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
  'admin.audit.list': route({
    method: 'GET',
    path: '/admin/audit',
    access: 'admin',
    query: {
      before: S.optional(digits),
      limit: S.optional(limit),
      actorId: S.optional(MemberId),
      action: S.optional(S.string({ maxLength: 100 })),
    },
    response: S.struct({ entries: S.array(AuditEntry), hasMore: S.boolean }),
  }),
} as const satisfies Readonly<Record<string, Route>>

export type Contract = typeof contract
export type RouteName = keyof Contract

/** Route names an agent credential can never call. Derived, for tests and documentation. */
export const humanOnlyRoutes = (Object.keys(contract) as RouteName[]).filter(
  (name) => contract[name].access === 'human' || contract[name].access === 'admin',
)

/** Fills a path template: `fillPath('/notes/:id', { id: 'note_1' })`. Values are URL-encoded. */
export const fillPath = (path: string, params: Readonly<Record<string, string>>): string =>
  path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    const value = params[key]
    if (value === undefined) throw new RangeError(`missing path parameter "${key}"`)
    return encodeURIComponent(value)
  })

/** Matches a concrete path against a template, returning decoded parameters or null. */
export const matchPath = (template: string, path: string): Record<string, string> | null => {
  const want = template.split('/')
  const got = path.split('/')
  if (want.length !== got.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < want.length; i++) {
    const segment = want[i]!
    const value = got[i]!
    if (segment.startsWith(':')) {
      if (value === '') return null
      try {
        params[segment.slice(1)] = decodeURIComponent(value)
      } catch {
        return null
      }
    } else if (segment !== value) return null
  }
  return params
}
