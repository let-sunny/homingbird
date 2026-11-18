import { Task as T } from '@homingbird/kernel'
import type {
  ApiError,
  DraftRequest,
  DraftRequestId,
  EventType,
  InboxItem,
  MemberId,
  Note,
  NoteId,
} from '@homingbird/protocol'
import type { MemberApi } from './member-api.ts'
import { quoteNote, quotingFor } from './quote.ts'

export interface Trigger {
  readonly kind: 'note' | 'draft_request'
  readonly meta: Readonly<Record<string, string>>
  readonly text: string
}

export interface TriggerContext {
  readonly api: MemberApi
  readonly nonce: () => string
  readonly announced?: AnnouncedRequests
}

export interface AnnouncedRequests {
  readonly has: (id: DraftRequestId) => boolean
  readonly add: (id: DraftRequestId) => void
}

export const freshTriggers = (context: TriggerContext): T.Task<ReadonlyArray<Trigger>, ApiError> =>
  triggersFrom([notesToPickUp, draftsRequested], context)

export const waitingTriggers = (
  context: TriggerContext,
  except: ReadonlySet<NoteId> = new Set(),
): T.Task<ReadonlyArray<Trigger>, ApiError> =>
  triggersFrom([(each) => notesWaiting(each, except), draftsRequested], context)

export const waitingNoteIds = (context: TriggerContext): T.Task<ReadonlySet<NoteId>, ApiError> =>
  T.map(({ items }: { items: ReadonlyArray<InboxItem> }) => new Set(items.map((item) => item.note.id)))(
    context.api['inbox.list']({ query: {} }),
  )

export const WAKING_EVENTS: ReadonlyArray<EventType> = ['note.sent', 'draft.requested', 'resync']

export const announcedRequests = (): AnnouncedRequests => {
  const seen = new Set<DraftRequestId>()
  return { has: (id) => seen.has(id), add: (id) => void seen.add(id) }
}

type TriggerSource = (context: TriggerContext) => T.Task<ReadonlyArray<Trigger>, ApiError>

const triggersFrom = (
  sources: ReadonlyArray<TriggerSource>,
  context: TriggerContext,
): T.Task<ReadonlyArray<Trigger>, ApiError> =>
  T.map((found: ReadonlyArray<ReadonlyArray<Trigger>>) => found.flat())(
    T.forEach(sources, (source) => source(context)),
  )

const notesToPickUp: TriggerSource = (context) =>
  T.gen(function* () {
    const { items } = yield* context.api['inbox.list']({ query: { fresh: '1' } })
    yield* T.forEach(items, (item) => context.api['notes.pickup']({ params: { id: item.note.id } }))
    return items.map((item) =>
      noteTrigger(
        item,
        context,
        `Draft a reply to this note with draft_reply, noteId ${item.note.id}. Your human approves it before it is sent.`,
      ),
    )
  })

const notesWaiting = (context: TriggerContext, except: ReadonlySet<NoteId>) =>
  T.gen(function* () {
    const { items } = yield* context.api['inbox.list']({ query: {} })
    const listed = items.filter((item) => !except.has(item.note.id))
    if (listed.length === 0) return []
    const { member } = yield* context.api['me.get']({})
    return listed.map((item) =>
      noteTrigger(
        item,
        context,
        isBeingDrafted(item.note, member.id)
          ? `One of your human’s agents, usually their desk session, is already drafting a reply to this note. Draft another with draft_reply, noteId ${item.note.id}, only if your human asks you to.`
          : `No agent is drafting a reply to this note yet. If your human wants one from this session, draft it with draft_reply, noteId ${item.note.id}. Your human approves it before it is sent.`,
      ),
    )
  })

const noteTrigger = ({ note, author }: InboxItem, context: TriggerContext, advice: string): Trigger => ({
  kind: 'note',
  meta: { kind: 'note', note_id: note.id, conversation_id: note.conversationId },
  text: [quoteNote(note, { nonce: context.nonce, authors: new Map([[author.id, author]]) }), advice].join(
    '\n\n',
  ),
})

const isBeingDrafted = (note: Note, viewerId: MemberId): boolean =>
  note.receipts.some((receipt) => receipt.memberId === viewerId && receipt.state === 'drafting')

const draftsRequested: TriggerSource = (context) =>
  T.catchAll(() => T.succeed<ReadonlyArray<Trigger>>([]))(
    T.gen(function* () {
      const { requests } = yield* context.api['draftRequests.list']({})
      const waiting = requests.filter((request) => !(context.announced?.has(request.id) ?? false))
      const triggers = yield* T.forEach(waiting, (request) => requestTrigger(request, context))
      for (const request of waiting) context.announced?.add(request.id)
      return triggers
    }),
  )

const requestTrigger = (request: DraftRequest, context: TriggerContext): T.Task<Trigger> =>
  T.map((answered: string | null) => ({
    kind: 'draft_request' as const,
    meta: {
      kind: 'draft_request',
      request_id: request.id,
      conversation_id: request.conversationId,
      ...(request.inReplyTo !== null && { in_reply_to: request.inReplyTo }),
    },
    text: [
      `Your human asked you for a draft: request ${request.id}, in conversation ${request.conversationId}.`,
      request.instruction.trim() === ''
        ? 'They gave no instruction: write the note that fits the conversation, using what you know from your work.'
        : `Their instruction, from your own human:\n${request.instruction.trim()}`,
      ...(answered === null ? [] : ['The draft answers this note from a colleague:', answered]),
      `Write it with draft_note, passing requestId ${request.id} and the text; the request already says where it goes. Your human approves it before it is sent.`,
    ].join('\n\n'),
  }))(request.inReplyTo === null ? T.succeed(null) : quotedOriginal(request.inReplyTo, context))

const quotedOriginal = (
  noteId: NonNullable<DraftRequest['inReplyTo']>,
  context: TriggerContext,
): T.Task<string> =>
  T.catchAll(() =>
    T.succeed(`(The note ${noteId} could not be loaded just now. Read it with get_note before drafting.)`),
  )(
    T.gen(function* () {
      const note = yield* context.api['notes.get']({ params: { id: noteId } })
      return quoteNote(note, yield* quotingFor(context.api, context.nonce))
    }),
  )
