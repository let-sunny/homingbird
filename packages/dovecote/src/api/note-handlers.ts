import { Task as T } from '@homingbird/kernel'
import {
  type Contract,
  type Conversation,
  ConversationId,
  DraftRequestId,
  type EarlierAnswer,
  type InboxItem,
  Invalid,
  NotFound,
  type Note,
  NoteId,
  type ResponseOf,
} from '@homingbird/protocol'
import { discardDraft, sendDraft } from '../domain/approval.ts'
import { conversationFor, createGroupConversation, listConversations } from '../domain/conversations.ts'
import {
  answerDraftRequest,
  cancelDraftRequest,
  openDraftRequests,
  requestDraft,
} from '../domain/draft-requests.ts'
import { createDraft, markDraftSeen, updateDraft } from '../domain/drafts.ts'
import { earlierAnswers, recordAnsweredFromHistory } from '../domain/earlier-answers.ts'
import { setHidden } from '../domain/hides.ts'
import { notesAwaitingReply } from '../domain/inbox.ts'
import { leaveGroup } from '../domain/leaving.ts'
import { setMuted } from '../domain/mutes.ts'
import { draftsOf, notesInConversation, searchNotes, visibleNote } from '../domain/notes.ts'
import {
  inReadableRooms,
  requireReadableRoom,
  requireReadableTarget,
} from '../domain/private-question-readers.ts'
import { recallNote } from '../domain/recalls.ts'
import { markRead, pickUp, release } from '../domain/receipts.ts'
import { draftAnswerFromRoom, reviseAnswerFromRoom } from '../domain/room-answers.ts'
import { isHuman } from '../environment.ts'
import type { Handlers } from './handlers.ts'
import { identifier, pageSize } from './route-parameters.ts'

/** Conversations, the notes in them, the inbox, drafts and their approval, and requests for a draft. */
export const noteHandlers = {
  'conversations.list': (_, caller) =>
    T.map((conversations: Awaited<ResponseOf<Contract['conversations.list']>>['conversations']) => ({
      conversations,
    }))(
      T.flatMap((all: Conversation[]) => inReadableRooms(caller, all, (conversation) => conversation.id))(
        listConversations(caller.member.id, isHuman(caller)),
      ),
    ),
  'conversations.create': ({ body }, caller) =>
    createGroupConversation(caller.member.id, body.participantIds, body.title),
  'conversations.get': ({ params }, caller) =>
    T.flatMap((id: ConversationId) =>
      T.flatMap(() => conversationFor(caller.member.id, id, isHuman(caller)))(
        requireReadableRoom(caller, id),
      ),
    )(identifier(ConversationId, params.id)),
  'conversations.mute': ({ params }, caller) =>
    T.flatMap((id: ConversationId) => setMuted(caller.member.id, id, true))(
      identifier(ConversationId, params.id),
    ),
  'conversations.unmute': ({ params }, caller) =>
    T.flatMap((id: ConversationId) => setMuted(caller.member.id, id, false))(
      identifier(ConversationId, params.id),
    ),
  'conversations.hide': ({ params }, caller) =>
    T.flatMap((id: ConversationId) => setHidden(caller.member.id, id, true))(
      identifier(ConversationId, params.id),
    ),
  'conversations.unhide': ({ params }, caller) =>
    T.flatMap((id: ConversationId) => setHidden(caller.member.id, id, false))(
      identifier(ConversationId, params.id),
    ),
  'conversations.leave': ({ params }, caller) =>
    T.flatMap((id: ConversationId) => T.as({})(leaveGroup(caller, id)))(
      identifier(ConversationId, params.id),
    ),
  'conversations.notes': ({ params, query }, caller) =>
    T.flatMap((id: ConversationId) =>
      T.flatMap(() =>
        notesInConversation(caller.member.id, id, {
          before: query.before === undefined ? null : Number(query.before),
          limit: pageSize(query.limit),
        }),
      )(requireReadableRoom(caller, id)),
    )(identifier(ConversationId, params.id)),
  'notes.get': ({ params }, caller) =>
    T.flatMap((id: NoteId) =>
      T.tap((note: Note) => T.mapError(noSuchNote)(requireReadableRoom(caller, note.conversationId)))(
        visibleNote(caller.member.id, id),
      ),
    )(identifier(NoteId, params.id)),
  'notes.read': ({ params }, caller) =>
    T.flatMap((id: NoteId) => markRead(caller, id))(identifier(NoteId, params.id)),
  'notes.pickup': ({ params }, caller) =>
    T.flatMap((id: NoteId) => pickUp(caller, id))(identifier(NoteId, params.id)),
  'notes.release': ({ params, body }, caller) =>
    T.flatMap((id: NoteId) => release(caller, id, body.reason))(identifier(NoteId, params.id)),
  'notes.recall': ({ params }, caller) =>
    T.flatMap((id: NoteId) => recallNote(caller, id))(identifier(NoteId, params.id)),
  'inbox.list': ({ query }, caller) =>
    T.map((items: Awaited<ResponseOf<Contract['inbox.list']>>['items']) => ({ items }))(
      T.flatMap((items: InboxItem[]) => inReadableRooms(caller, items, (item) => item.note.conversationId))(
        notesAwaitingReply(caller, query.fresh === '1'),
      ),
    ),
  'search.notes': ({ query }, caller) =>
    T.map((notes: Awaited<ResponseOf<Contract['search.notes']>>['notes']) => ({ notes }))(
      T.flatMap((notes: Note[]) => inReadableRooms(caller, notes, (note) => note.conversationId))(
        searchNotes(caller.member.id, query.q, pageSize(query.limit)),
      ),
    ),
  'answers.earlier': ({ body }, caller) =>
    T.map((answers: Awaited<ResponseOf<Contract['answers.earlier']>>['answers']) => ({ answers }))(
      T.flatMap((answers: EarlierAnswer[]) =>
        inReadableRooms(caller, answers, (earlier) => earlier.answer.conversationId),
      )(earlierAnswers(caller.member.id, body)),
    ),
  'answers.used': ({ params, body }, caller) =>
    T.flatMap((id: NoteId) => recordAnsweredFromHistory(caller.member.id, id, body.conversationId))(
      identifier(NoteId, params.id),
    ),

  'drafts.list': (_, caller) =>
    T.map((drafts: Awaited<ResponseOf<Contract['drafts.list']>>['drafts']) => ({ drafts }))(
      draftsOf(caller.member.id),
    ),
  'drafts.create': ({ body: { requestId, debateId, ...target } }, caller) =>
    debateId !== undefined
      ? requestId === undefined
        ? T.flatMap(() => draftAnswerFromRoom(caller, debateId, target))(
            requireReadableTarget(caller, target),
          )
        : T.fail(Invalid({ message: 'A draft answers a request or a room, not both.' }))
      : requestId === undefined
        ? T.flatMap(() => createDraft(caller, target))(requireReadableTarget(caller, target))
        : answerDraftRequest(caller, requestId, {
            body: target.body,
            ...(target.tags !== undefined && { tags: target.tags }),
            ...(target.basis !== undefined && { basis: target.basis }),
            ...(target.sources !== undefined && { sources: target.sources }),
            ...(target.client !== undefined && { client: target.client }),
            ...(target.model !== undefined && { model: target.model }),
            ...(target.session !== undefined && { session: target.session }),
          }),
  'drafts.update': ({ params, body: { debateId, ...change } }, caller) =>
    T.flatMap((id: NoteId) =>
      debateId === undefined
        ? updateDraft(caller, id, change)
        : reviseAnswerFromRoom(caller, id, debateId, change),
    )(identifier(NoteId, params.id)),
  'drafts.send': ({ params, body }, caller) =>
    T.flatMap((id: NoteId) => sendDraft(caller, id, body.body, body.expected))(identifier(NoteId, params.id)),
  'drafts.discard': ({ params, body }, caller) =>
    T.flatMap((id: NoteId) => discardDraft(caller, id, body.reason))(identifier(NoteId, params.id)),
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

const noSuchNote = (): NotFound => NotFound({ message: 'No such note.' })
