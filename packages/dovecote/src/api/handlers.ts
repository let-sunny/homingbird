import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  type Channel,
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
} from '@homingbird/protocol'
import { decideConsent, decideDeviceRequest, describeConsent, describeDeviceRequest } from '../auth/oauth.ts'
import { listAudit } from '../domain/audit.ts'
import { archiveChannel, reviseChannel } from '../domain/channel-administration.ts'
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
import { agentReportFor, organizationInsights } from '../domain/insights.ts'
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
  markDraftSeen,
  markRead,
  moveToChannel,
  notesAwaitingReply,
  notesInConversation,
  pickUp,
  release,
  searchNotes,
  sendDraft,
  updateDraft,
  visibleNote,
} from '../domain/notes.ts'
import {
  createPrinciple,
  deletePrinciple,
  dismissOffer,
  myPrinciples,
  principlesForDrafting,
  recordMiss,
  reorderPrinciples,
  updatePrinciple,
} from '../domain/principles.ts'
import { readAnsweringFlow, readSettings, writeSettings } from '../domain/settings.ts'
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
        features: settings.features ?? {},
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
      directoryFor(caller.member, query.q, query.channel),
    ),
  'channels.list': ({ query }, caller) =>
    listChannels(caller.member, {
      search: query.q,
      limit: Math.max(1, Math.min(MAX_CHANNEL_PAGE, Number(query.limit ?? DEFAULT_CHANNEL_PAGE))),
      offset: Number(query.cursor ?? 0),
    }),
  'channels.get': ({ params }, caller) => channelNamed(caller.member, params.slug),
  'channels.create': ({ body }, caller) =>
    announcingChannel(caller.member.id, createChannel(caller.member, body)),
  'channels.join': ({ params, body }, caller) =>
    announcingChannel(caller.member.id, joinChannel(caller.member, params.slug, body.answering === true)),
  'channels.leave': ({ params }, caller) =>
    announcingChannel(caller.member.id, leaveChannel(caller.member, params.slug)),
  'channels.answering.on': ({ params }, caller) =>
    announcingChannel(caller.member.id, setAnswering(caller.member, params.slug, true)),
  'channels.answering.off': ({ params }, caller) =>
    announcingChannel(caller.member.id, setAnswering(caller.member, params.slug, false)),
  'channels.visibility.set': ({ params, body }, caller) =>
    announcingChannel(caller.member.id, setVisibility(caller.member, params.slug, body.visibility)),
  'channels.members.list': ({ params }, caller) =>
    T.map((members: Awaited<ResponseOf<Contract['channels.members.list']>>['members']) => ({ members }))(
      channelMembers(caller.member, params.slug),
    ),
  'channels.members.add': ({ params }, caller) =>
    T.flatMap((memberId: MemberId) =>
      announcingChannel(memberId, addChannelMember(caller.member, params.slug, memberId)),
    )(identifier(MemberId, params.memberId)),
  'channels.members.remove': ({ params }, caller) =>
    T.flatMap((memberId: MemberId) =>
      announcingChannel(memberId, removeChannelMember(caller.member, params.slug, memberId)),
    )(identifier(MemberId, params.memberId)),
  'channels.managers.add': ({ params }, caller) =>
    T.flatMap((memberId: MemberId) => grantManager(caller.member, params.slug, memberId))(
      identifier(MemberId, params.memberId),
    ),
  'channels.managers.remove': ({ params }, caller) =>
    T.flatMap((memberId: MemberId) => revokeManager(caller.member, params.slug, memberId))(
      identifier(MemberId, params.memberId),
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
    T.flatMap((id: NoteId) => moveToChannel(caller, id, body.channel))(identifier(NoteId, params.id)),
  'notes.pickup': ({ params }, caller) =>
    T.flatMap((id: NoteId) => pickUp(caller, id))(identifier(NoteId, params.id)),
  'notes.release': ({ params, body }, caller) =>
    T.flatMap((id: NoteId) => release(caller, id, body.reason))(identifier(NoteId, params.id)),
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
      : answerDraftRequest(caller, requestId, {
          body: target.body,
          ...(target.basis !== undefined && { basis: target.basis }),
          ...(target.client !== undefined && { client: target.client }),
          ...(target.model !== undefined && { model: target.model }),
          ...(target.session !== undefined && { session: target.session }),
        }),
  'drafts.update': ({ params, body }, caller) =>
    T.flatMap((id: NoteId) => updateDraft(caller, id, body))(identifier(NoteId, params.id)),
  'drafts.send': ({ params, body }, caller) =>
    T.flatMap((id: NoteId) => sendDraft(caller, id, body.body))(identifier(NoteId, params.id)),
  'drafts.discard': ({ params }, caller) =>
    T.flatMap((id: NoteId) => discardDraft(caller, id))(identifier(NoteId, params.id)),
  'drafts.seen': ({ params }, caller) =>
    T.as({})(T.flatMap((id: NoteId) => markDraftSeen(caller, id))(identifier(NoteId, params.id))),

  'insights.mine': (_, caller) => agentReportFor(caller.member.id),

  'principles.list': (_, caller) => myPrinciples(caller.member.id),
  'principles.create': ({ body }, caller) => createPrinciple(caller.member.id, body),
  'principles.update': ({ params, body }, caller) => updatePrinciple(caller.member.id, params.id, body),
  'principles.reorder': ({ body }, caller) => reorderPrinciples(caller.member.id, body.ids),
  'principles.delete': ({ params }, caller) => deletePrinciple(caller.member.id, params.id),
  'principles.miss': ({ params, body }, caller) => recordMiss(caller.member.id, params.id, body.noteId),
  'principles.offers.dismiss': ({ params, body }, caller) =>
    T.as({})(dismissOffer(caller.member.id, params.id, body.stopAskingHere === true)),
  'principles.drafting': ({ query }, caller) => principlesForDrafting(caller.member.id, query.conversationId),

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
  'push.test': (_, caller) =>
    T.gen(function* () {
      const env = yield* T.ask<RequestEnv>()
      return { results: [...(yield* env.pushTest(caller.member.id))] }
    }),
  'presence.visibility': ({ body }, caller) =>
    T.map((env: RequestEnv) => {
      env.hub.reportVisibility(caller.member.id, `${caller.credential.id}:${body.page}`, body.visible)
      return {}
    })(T.ask<RequestEnv>()),
  'push.unsubscribe': ({ body }, caller) =>
    T.as({})(removeOwnPushSubscription(caller.member.id, body.endpoint)),

  'events.poll': ({ query }, caller) =>
    waitForEvents(
      caller.member.id,
      Number(query.after ?? '0'),
      Math.min(Number(query.wait ?? '0'), POLL_WAIT_MAX_SECONDS) * 1000,
    ),

  'answeringFlow.get': () => readAnsweringFlow,
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
  'admin.channels.update': ({ params, body }, caller) =>
    T.tap((_: Channel) => announceDirectoryChange(caller.member.id))(
      reviseChannel(caller.member, params.slug, body),
    ),
  'admin.channels.archive': ({ params, body }, caller) =>
    T.as({})(
      T.tap(() => announceDirectoryChange(caller.member.id))(
        archiveChannel(params.slug, body.moveMembersTo ?? null),
      ),
    ),
  'admin.insights': () => organizationInsights,
  'admin.audit.list': ({ query }) =>
    listAudit({
      before: query.before === undefined ? null : Number(query.before),
      limit: pageSize(query.limit),
      ...(query.actorId !== undefined && { actorId: query.actorId }),
      ...(query.action !== undefined && { action: query.action }),
    }),
}

const announcingChannel = <E>(
  memberId: MemberId,
  change: T.Task<Channel, E, RequestEnv>,
): T.Task<Channel, E, RequestEnv> => T.tap((_: Channel) => announceDirectoryChange(memberId))(change)

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

const DEFAULT_CHANNEL_PAGE = 50
const MAX_CHANNEL_PAGE = 200

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
