import { Task as T } from '@homingbird/kernel'
import { type Contract, ConversationId, DraftRequestId, NoteId, type ResponseOf } from '@homingbird/protocol'
import { discardDraft, sendDraft } from '../domain/approval.ts'
import { conversationFor, createGroupConversation, listConversations } from '../domain/conversations.ts'
import {
  answerDraftRequest,
  cancelDraftRequest,
  openDraftRequests,
  requestDraft,
} from '../domain/draft-requests.ts'
import { createDraft, markDraftSeen, updateDraft } from '../domain/drafts.ts'
import { notesAwaitingReply } from '../domain/inbox.ts'
import { moveToChannel } from '../domain/note-moves.ts'
import { draftsOf, notesInConversation, searchNotes, visibleNote } from '../domain/notes.ts'
import { markRead, pickUp, release } from '../domain/receipts.ts'
import type { Handlers } from './handlers.ts'
import { identifier, pageSize } from './route-parameters.ts'

/** Conversations, the notes in them, the inbox, drafts and their approval, and requests for a draft. */
export const noteHandlers = {
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
    T.flatMap((id: NoteId) => sendDraft(caller, id, body.body, body.expected))(identifier(NoteId, params.id)),
  'drafts.discard': ({ params }, caller) =>
    T.flatMap((id: NoteId) => discardDraft(caller, id))(identifier(NoteId, params.id)),
  'drafts.seen': ({ params }, caller) =>
    T.as({})(T.flatMap((id: NoteId) => markDraftSeen(caller, id))(identifier(NoteId, params.id))),

  'draftRequests.list': (_, caller) =>
    T.map((requests: Awaited<ResponseOf<Contract['draftRequests.list']>>['requests']) => ({ requests }))(
      openDraftRequests(caller),
    ),
  'draftRequests.create': ({ body }, caller) => requestDraft(caller, body),
  'draftRequests.cancel': ({ params }, caller) =>
    T.flatMap((id: DraftRequestId) => cancelDraftRequest(caller, id))(identifier(DraftRequestId, params.id)),
} satisfies Partial<Handlers>
