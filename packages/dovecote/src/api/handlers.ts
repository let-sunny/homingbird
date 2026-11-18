import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  type Contract,
  ConversationId,
  CredentialId,
  DraftRequestId,
  Invalid,
  type Member,
  MemberId,
  NoteId,
  POLL_WAIT_MAX_SECONDS,
  type RequestOf,
  type ResponseOf,
  type RouteName,
  type Topic,
} from '@homingbird/protocol'
import { decideConsent, decideDeviceRequest, describeConsent, describeDeviceRequest } from '../auth/oauth.ts'
import { listAudit } from '../domain/audit.ts'
import { clearCharacter, saveCharacter } from '../domain/characters.ts'
import {
  acceptContact,
  block,
  listContacts,
  removeContact,
  requestContact,
  unblock,
} from '../domain/contacts.ts'
import { conversationFor, createGroupConversation, listConversations } from '../domain/conversations.ts'
import { listCredentials, renameCredential, revokeCredential } from '../domain/credentials.ts'
import {
  answerDraftRequest,
  cancelDraftRequest,
  openDraftRequests,
  requestDraft,
} from '../domain/draft-requests.ts'
import {
  administerMember,
  allMembers,
  chosenLocaleOf,
  directoryFor,
  updateOwnProfile,
} from '../domain/members.ts'
import {
  createDraft,
  discardDraft,
  draftsOf,
  markRead,
  moveToTopic,
  notesAwaitingReply,
  notesInConversation,
  pickUp,
  searchNotes,
  sendDraft,
  updateDraft,
  visibleNote,
} from '../domain/notes.ts'
import { readSettings, writeSettings } from '../domain/settings.ts'
import {
  createTopic,
  listTopics,
  mergeTopic,
  removeTopic,
  reviseTopic,
  startHelping,
  stopHelping,
} from '../domain/topics.ts'
import type { Caller } from '../environment.ts'
import { type RequestEnv, announceDirectoryChange, waitForEvents } from '../events/events.ts'
import { removeOwnPushSubscription, savePushSubscription } from '../push/subscriptions.ts'
import { vapidKeys } from '../push/vapid.ts'
import { SERVER_VERSION } from '../version.ts'

export type CallerOf<N extends RouteName> = Contract[N]['access'] extends 'public' ? null : Caller

export type Handlers = {
  readonly [N in RouteName]: (
    request: RequestOf<Contract[N]>,
    caller: CallerOf<N>,
  ) => T.Task<ResponseOf<Contract[N]>, ApiError, RequestEnv>
}

export const handlers: Handlers = {
  'server.info': () =>
    T.gen(function* () {
      const env = yield* T.ask<RequestEnv>()
      const settings = yield* readSettings
      return {
        name: 'dovecote',
        version: SERVER_VERSION,
        contactMode: settings.contactMode,
        signInWith: env.config.identity.label,
        approveButton: env.config.approveButton,
      }
    }),
  'me.get': (_, caller) =>
    T.gen(function* () {
      const settings = yield* readSettings
      const locale = yield* chosenLocaleOf(caller.member.id)
      return {
        member: caller.member,
        credential: caller.credential,
        contactMode: settings.contactMode,
        ...(locale !== null && { locale }),
      }
    }),
  'me.update': ({ body }, caller) =>
    T.tap((_: Member) => announceDirectoryChange(caller.member.id))(updateOwnProfile(caller.member.id, body)),
  'me.character.set': ({ body }, caller) =>
    T.tap((_: Member) => announceDirectoryChange(caller.member.id))(saveCharacter(caller.member.id, body)),
  'me.character.clear': (_, caller) =>
    T.tap((_: Member) => announceDirectoryChange(caller.member.id))(clearCharacter(caller.member.id)),

  'directory.list': ({ query }, caller) =>
    T.map((entries: Awaited<ResponseOf<Contract['directory.list']>>['entries']) => ({ entries }))(
      directoryFor(caller.member.id, query.q, query.topic),
    ),
  'topics.list': ({ query }, caller) =>
    T.map((topics: Topic[]) => ({ topics }))(listTopics(caller.member.id, query.q)),
  'topics.create': ({ body }, caller) =>
    T.tap((_: Topic) => announceDirectoryChange(caller.member.id))(createTopic(caller.member.id, body)),
  'topics.help': ({ params }, caller) =>
    T.tap((_: Topic) => announceDirectoryChange(caller.member.id))(
      startHelping(caller.member.id, params.slug),
    ),
  'topics.leave': ({ params }, caller) =>
    T.tap((_: Topic) => announceDirectoryChange(caller.member.id))(
      stopHelping(caller.member.id, params.slug),
    ),
  'contacts.list': (_, caller) => listContacts(caller.member.id),
  'contacts.request': ({ body }, caller) => requestContact(caller.member.id, body.memberId),
  'contacts.accept': ({ params }, caller) =>
    T.flatMap((memberId: MemberId) => acceptContact(caller.member.id, memberId))(
      identifier(MemberId, params.memberId),
    ),
  'contacts.remove': ({ params }, caller) =>
    T.as({})(
      T.flatMap((memberId: MemberId) => removeContact(caller.member.id, memberId))(
        identifier(MemberId, params.memberId),
      ),
    ),
  'blocks.add': ({ params }, caller) =>
    T.as({})(
      T.flatMap((memberId: MemberId) => block(caller.member.id, memberId))(
        identifier(MemberId, params.memberId),
      ),
    ),
  'blocks.remove': ({ params }, caller) =>
    T.as({})(
      T.flatMap((memberId: MemberId) => unblock(caller.member.id, memberId))(
        identifier(MemberId, params.memberId),
      ),
    ),

  'conversations.list': (_, caller) =>
    T.map((conversations: Awaited<ResponseOf<Contract['conversations.list']>>['conversations']) => ({
      conversations,
    }))(listConversations(caller.member.id)),
  'conversations.create': ({ body }, caller) =>
    createGroupConversation(caller.member.id, body.participantIds, body.title),
  'conversations.get': ({ params }, caller) =>
    T.flatMap((id: ConversationId) => conversationFor(caller.member.id, id))(
      identifier(ConversationId, params.id),
    ),
  'conversations.notes': ({ params, query }, caller) =>
    T.flatMap((id: ConversationId) =>
      notesInConversation(caller.member.id, id, {
        before: query.before === undefined ? null : Number(query.before),
        limit: pageSize(query.limit),
      }),
    )(identifier(ConversationId, params.id)),
  'notes.get': ({ params }, caller) =>
    T.flatMap((id: NoteId) => visibleNote(caller.member.id, id))(identifier(NoteId, params.id)),
  'notes.read': ({ params }, caller) =>
    T.flatMap((id: NoteId) => markRead(caller, id))(identifier(NoteId, params.id)),
  'notes.move': ({ params, body }, caller) =>
    T.flatMap((id: NoteId) => moveToTopic(caller, id, body.topic))(identifier(NoteId, params.id)),
  'notes.pickup': ({ params }, caller) =>
    T.flatMap((id: NoteId) => pickUp(caller, id))(identifier(NoteId, params.id)),
  'inbox.list': ({ query }, caller) =>
    T.map((items: Awaited<ResponseOf<Contract['inbox.list']>>['items']) => ({ items }))(
      notesAwaitingReply(caller, query.fresh === '1'),
    ),
  'search.notes': ({ query }, caller) =>
    T.map((notes: Awaited<ResponseOf<Contract['search.notes']>>['notes']) => ({ notes }))(
      searchNotes(caller.member.id, query.q, pageSize(query.limit)),
    ),

  'drafts.list': (_, caller) =>
    T.map((drafts: Awaited<ResponseOf<Contract['drafts.list']>>['drafts']) => ({ drafts }))(
      draftsOf(caller.member.id),
    ),
  'drafts.create': ({ body: { requestId, ...target } }, caller) =>
    requestId === undefined
      ? createDraft(caller, target)
      : answerDraftRequest(caller, requestId, target.body),
  'drafts.update': ({ params, body }, caller) =>
    T.flatMap((id: NoteId) => updateDraft(caller, id, body))(identifier(NoteId, params.id)),
  'drafts.send': ({ params, body }, caller) =>
    T.flatMap((id: NoteId) => sendDraft(caller, id, body.body))(identifier(NoteId, params.id)),
  'drafts.discard': ({ params }, caller) =>
    T.flatMap((id: NoteId) => discardDraft(caller, id))(identifier(NoteId, params.id)),

  'draftRequests.list': (_, caller) =>
    T.map((requests: Awaited<ResponseOf<Contract['draftRequests.list']>>['requests']) => ({ requests }))(
      openDraftRequests(caller),
    ),
  'draftRequests.create': ({ body }, caller) => requestDraft(caller, body),
  'draftRequests.cancel': ({ params }, caller) =>
    T.flatMap((id: DraftRequestId) => cancelDraftRequest(caller, id))(identifier(DraftRequestId, params.id)),

  'credentials.list': (_, caller) =>
    T.map((credentials: Awaited<ResponseOf<Contract['credentials.list']>>['credentials']) => ({
      credentials,
    }))(listCredentials(caller.member.id, caller.credential.id)),
  'credentials.rename': ({ params, body }, caller) =>
    T.flatMap((id: CredentialId) => renameCredential(caller.member.id, caller.credential.id, id, body.name))(
      identifier(CredentialId, params.id),
    ),
  'credentials.revoke': ({ params }, caller) =>
    T.as({})(
      T.flatMap((id: CredentialId) => revokeCredential(caller.member.id, id))(
        identifier(CredentialId, params.id),
      ),
    ),
  'device.get': ({ params }) => describeDeviceRequest(params.userCode),
  'device.decide': ({ params, body }, caller) => T.as({})(decideDeviceRequest(caller, params.userCode, body)),
  'consent.get': ({ params }) => describeConsent(params.id),
  'consent.decide': ({ params, body }, caller) => decideConsent(caller, params.id, body),

  'push.key': () => T.map((keys: { publicKey: string }) => ({ publicKey: keys.publicKey }))(vapidKeys),
  'push.subscribe': ({ body }, caller) => T.as({})(savePushSubscription(caller.member.id, body)),
  'push.unsubscribe': ({ body }, caller) =>
    T.as({})(removeOwnPushSubscription(caller.member.id, body.endpoint)),

  'events.poll': ({ query }, caller) =>
    waitForEvents(
      caller.member.id,
      Number(query.after ?? '0'),
      Math.min(Number(query.wait ?? '0'), POLL_WAIT_MAX_SECONDS) * 1000,
    ),

  'admin.settings.get': () => readSettings,
  'admin.settings.put': ({ body }) => writeSettings(body),
  'admin.members.list': () =>
    T.map((members: Awaited<ResponseOf<Contract['admin.members.list']>>['members']) => ({ members }))(
      allMembers,
    ),
  'admin.members.update': ({ params, body }, caller) =>
    T.flatMap((id: MemberId) =>
      T.tap((_: Member) => announceDirectoryChange(id))(administerMember(caller.member.id, id, body)),
    )(identifier(MemberId, params.id)),
  'admin.members.resetCharacter': ({ params }) =>
    T.flatMap((id: MemberId) => T.tap((_: Member) => announceDirectoryChange(id))(clearCharacter(id)))(
      identifier(MemberId, params.id),
    ),
  'admin.topics.update': ({ params, body }, caller) =>
    T.tap((_: Topic) => announceDirectoryChange(caller.member.id))(
      reviseTopic(caller.member.id, params.slug, body),
    ),
  'admin.topics.remove': ({ params }, caller) =>
    T.as({})(T.tap(() => announceDirectoryChange(caller.member.id))(removeTopic(params.slug))),
  'admin.topics.merge': ({ params, body }, caller) =>
    T.tap((_: Topic) => announceDirectoryChange(caller.member.id))(
      mergeTopic(caller.member.id, params.slug, body.into),
    ),
  'admin.audit.list': ({ query }) =>
    listAudit({
      before: query.before === undefined ? null : Number(query.before),
      limit: pageSize(query.limit),
      ...(query.actorId !== undefined && { actorId: query.actorId }),
      ...(query.action !== undefined && { action: query.action }),
    }),
}

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

const pageSize = (limit: string | undefined): number =>
  Math.max(1, Math.min(MAX_PAGE_SIZE, limit === undefined ? DEFAULT_PAGE_SIZE : Number(limit)))

const identifier = <Id>(
  schema: {
    readonly decode: (
      input: unknown,
    ) => { readonly _tag: 'Ok'; readonly value: Id } | { readonly _tag: 'Err' }
  },
  raw: string,
): T.Task<Id, Invalid> => {
  const decoded = schema.decode(raw)
  return decoded._tag === 'Ok'
    ? T.succeed(decoded.value)
    : T.fail(Invalid({ message: 'That identifier is not valid.' }))
}
