import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  type AsRead,
  type ConversationId,
  type DraftRequest,
  type DraftRequestId,
  type MemberId,
  type NoteId,
  draftRequestText,
  draftingGuidance,
  flowGuidance,
  noteToAnswerText,
  principlesGuidance,
  quotedNote,
  waitingNoteText,
} from '@homingbird/protocol'
import type { MemberApi } from './member-api.ts'
import { quotingFor } from './quote.ts'

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
  T.gen(function* () {
    const pending = yield* pendingFrom([notesToPickUp, draftsRequested], context)
    if (pending.length === 0) return []
    const flow = flowGuidance(yield* T.result(context.api['answeringFlow.get']({})))
    return yield* T.forEach(pending, (trigger) =>
      T.map((principles: string) => triggerWith(trigger, draftingGuidance(flow, principles)))(
        principlesOf(context, trigger.meta.conversation_id),
      ),
    )
  })

export const waitingTriggers = (
  context: TriggerContext,
  except: ReadonlySet<NoteId> = new Set(),
): T.Task<ReadonlyArray<Trigger>, ApiError> =>
  T.map((pending: ReadonlyArray<PendingTrigger>) => pending.map((trigger) => triggerWith(trigger, '')))(
    pendingFrom([(each) => notesWaiting(each, except), draftsRequested], context),
  )

export const waitingNoteIds = (context: TriggerContext): T.Task<ReadonlySet<NoteId>, ApiError> =>
  T.map(
    ({ items }: { items: ReadonlyArray<AsRead.InboxItem> }) => new Set(items.map((item) => item.note.id)),
  )(context.api['inbox.list']({ query: {} }))

export const announcedRequests = (): AnnouncedRequests => {
  const seen = new Set<DraftRequestId>()
  return { has: (id) => seen.has(id), add: (id) => void seen.add(id) }
}

/** A trigger whose text still waits for its conversation's guidance, which goes before any quoted note. */
interface PendingTrigger {
  readonly kind: Trigger['kind']
  readonly meta: Trigger['meta']
  readonly textWith: (guidance: string) => string
}

const triggerWith = (trigger: PendingTrigger, guidance: string): Trigger => ({
  kind: trigger.kind,
  meta: trigger.meta,
  text: trigger.textWith(guidance),
})

type TriggerSource = (context: TriggerContext) => T.Task<ReadonlyArray<PendingTrigger>, ApiError>

const pendingFrom = (
  sources: ReadonlyArray<TriggerSource>,
  context: TriggerContext,
): T.Task<ReadonlyArray<PendingTrigger>, ApiError> =>
  T.map((found: ReadonlyArray<ReadonlyArray<PendingTrigger>>) => found.flat())(
    T.forEach(sources, (source) => source(context)),
  )

const notesToPickUp: TriggerSource = (context) =>
  T.gen(function* () {
    const { items } = yield* context.api['inbox.list']({ query: { fresh: '1' } })
    yield* T.forEach(items, (item) => context.api['notes.pickup']({ params: { id: item.note.id } }))
    return items.map((item) =>
      noteTrigger(item, (guidance, quoted) => noteToAnswerText(item.note.id, guidance, quoted), context),
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
        (_, quoted) => waitingNoteText(item.note.id, isBeingDrafted(item.note, member.id), quoted),
        context,
      ),
    )
  })

const noteTrigger = (
  { note, author }: AsRead.InboxItem,
  text: (guidance: string, quoted: string) => string,
  context: TriggerContext,
): PendingTrigger => {
  const quoted = quotedNote(note, { nonce: context.nonce, authors: new Map([[author.id, author]]) })
  return {
    kind: 'note',
    meta: { kind: 'note', note_id: note.id, conversation_id: note.conversationId },
    textWith: (guidance) => text(guidance, quoted),
  }
}

const principlesOf = (context: TriggerContext, conversationId: string | undefined): T.Task<string> =>
  T.map(principlesGuidance)(
    T.result(
      context.api['principles.drafting']({
        query: conversationId === undefined ? {} : { conversationId: conversationId as ConversationId },
      }),
    ),
  )

const isBeingDrafted = (note: AsRead.Note, viewerId: MemberId): boolean =>
  note.receipts.some((receipt) => receipt.memberId === viewerId && receipt.state === 'drafting')

const draftsRequested: TriggerSource = (context) =>
  T.catchAll(() => T.succeed<ReadonlyArray<PendingTrigger>>([]))(
    T.gen(function* () {
      const { requests } = yield* context.api['draftRequests.list']({})
      const waiting = requests.filter((request) => !(context.announced?.has(request.id) ?? false))
      const triggers = yield* T.forEach(waiting, (request) => requestTrigger(request, context))
      for (const request of waiting) context.announced?.add(request.id)
      return triggers
    }),
  )

const requestTrigger = (request: DraftRequest, context: TriggerContext): T.Task<PendingTrigger> =>
  T.map((answered: string | null) => ({
    kind: 'draft_request' as const,
    meta: {
      kind: 'draft_request',
      request_id: request.id,
      conversation_id: request.conversationId,
      ...(request.inReplyTo !== null && { in_reply_to: request.inReplyTo }),
    },
    textWith: (guidance: string) => draftRequestText(request, guidance, answered),
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
      return quotedNote(note, yield* quotingFor(context.api, context.nonce))
    }),
  )
