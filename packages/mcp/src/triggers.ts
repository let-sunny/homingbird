import { Task as T } from '@homingbird/kernel'
import type { ApiError, DraftRequest, DraftRequestId, EventType } from '@homingbird/protocol'
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
  T.map((found: ReadonlyArray<ReadonlyArray<Trigger>>) => found.flat())(
    T.forEach(TRIGGER_SOURCES, (source) => source(context)),
  )

export const WAKING_EVENTS: ReadonlyArray<EventType> = ['note.sent', 'draft.requested', 'resync']

export const announcedRequests = (): AnnouncedRequests => {
  const seen = new Set<DraftRequestId>()
  return { has: (id) => seen.has(id), add: (id) => void seen.add(id) }
}

type TriggerSource = (context: TriggerContext) => T.Task<ReadonlyArray<Trigger>, ApiError>

const notesAwaitingReply: TriggerSource = (context) =>
  T.gen(function* () {
    const { items } = yield* context.api['inbox.list']({ query: { fresh: '1' } })
    yield* T.forEach(items, (item) => context.api['notes.pickup']({ params: { id: item.note.id } }))
    return items.map(({ note, author }) => ({
      kind: 'note' as const,
      meta: { kind: 'note', note_id: note.id, conversation_id: note.conversationId },
      text: [
        quoteNote(note, { nonce: context.nonce, authors: new Map([[author.id, author]]) }),
        `Draft a reply to this note with draft_reply, noteId ${note.id}. Your human approves it before it is sent.`,
      ].join('\n\n'),
    }))
  })

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

const TRIGGER_SOURCES: ReadonlyArray<TriggerSource> = [notesAwaitingReply, draftsRequested]
