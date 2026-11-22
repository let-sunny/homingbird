import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  Conflict,
  type ConversationId,
  type CredentialId,
  type DraftRequest,
  type DraftRequestId,
  type MemberId,
  NotFound,
  type Note,
  type NoteId,
} from '@homingbird/protocol'
import { found } from './handlers.ts'
import { connectedAgentOf, mayRead } from './reads.ts'
import { destinationOf } from './rooms.ts'
import { saveDraft } from './sending.ts'
import type { Records, World } from './world.ts'

/**
 * The visitor asks their own agent for a draft from the web client: the request waits, and a few seconds
 * later the agent's draft arrives in that conversation, waiting for the visitor's click like any other.
 */
export const requestDraft = (
  world: World,
  viewerId: MemberId,
  wish: DraftWish,
): T.Task<DraftRequest, ApiError> =>
  T.gen(function* () {
    const conversationId = yield* conversationFor(world, viewerId, wish)
    if (wish.agentId !== undefined && connectedAgentOf(world.records(), viewerId, wish.agentId) === null)
      return yield* T.fail(NotFound({ message: 'No such connected agent.' }))
    const now = world.clock.now()
    const request: DraftRequest = {
      id: world.nextId('dreq') as DraftRequestId,
      conversationId,
      inReplyTo: wish.inReplyTo ?? null,
      instruction: wish.instruction ?? '',
      agentId: wish.agentId ?? null,
      createdAt: now,
      expiresAt: now + DRAFT_REQUEST_LIFETIME_MS,
      cancelledAt: null,
      draftIds: [],
    }
    world.update((records) => ({
      ...records,
      draftRequests: [...records.draftRequests, { request, memberId: viewerId }],
      notices: records.notices.filter(
        (kept) => kept.memberId !== viewerId || kept.notice.noteId !== request.inReplyTo,
      ),
    }))
    world.emit([viewerId], { type: 'draft.requested', request })
    world.after(OWN_AGENT_AFTER_MS, () => answerRequest(world, viewerId, request.id))
    return request
  })

/** The visitor withdraws a request their agent has not answered yet. */
export const cancelDraftRequest = (
  world: World,
  viewerId: MemberId,
  id: string,
): T.Task<DraftRequest, ApiError> =>
  T.gen(function* () {
    const waiting = yield* waitingRequest(world, viewerId, id)
    const cancelled = { ...waiting, cancelledAt: world.clock.now() }
    replaceRequest(world, cancelled)
    world.emit([viewerId], { type: 'draft.request.changed', request: cancelled })
    return cancelled
  })

/** The visitor's requests still open: neither withdrawn nor past their day. */
export const openDraftRequests = (records: Records, viewerId: MemberId, now: number): DraftRequest[] =>
  records.draftRequests
    .filter(
      (kept) =>
        kept.memberId === viewerId && kept.request.cancelledAt === null && kept.request.expiresAt > now,
    )
    .map((kept) => kept.request)

/**
 * A colleague asked the visitor something back: a few seconds later the visitor's agent drafts a reply,
 * so the loop of drafting and approving goes on. Nothing is sent until the visitor approves it.
 */
export const replyLater = (world: World, question: Note, visitorId: MemberId): void =>
  world.after(OWN_AGENT_AFTER_MS, () => {
    const agent = connectedAgentOf(world.records(), visitorId, null)
    if (agent === null) return
    saveDraft(world, {
      conversationId: question.conversationId,
      authorId: visitorId,
      body: FOLLOW_UP_REPLY,
      inReplyTo: question.id,
      agentName: agent.name,
      basis: 'This conversation and the on-call rota.',
    })
  })

/** How long the visitor's agent takes to write a draft. */
export const OWN_AGENT_AFTER_MS = 4_000

export const FOLLOW_UP_REPLY =
  'Tell me here first. If I have not answered within the hour, ask in #deploys and whoever is on call picks it up.'

export interface DraftWish {
  readonly conversationId?: ConversationId
  readonly to?: ReadonlyArray<MemberId>
  readonly channel?: string
  readonly inReplyTo?: NoteId
  readonly instruction?: string
  readonly agentId?: CredentialId
}

const answerRequest = (world: World, viewerId: MemberId, id: DraftRequestId): void => {
  const kept = world.records().draftRequests.find((each) => each.request.id === id)
  if (kept === undefined || kept.request.cancelledAt !== null) return
  const agent = connectedAgentOf(world.records(), viewerId, kept.request.agentId)
  if (agent === null) return
  const draft = saveDraft(world, {
    conversationId: kept.request.conversationId,
    authorId: viewerId,
    body: kept.request.inReplyTo === null ? REQUESTED_NOTE : REQUESTED_REPLY,
    inReplyTo: kept.request.inReplyTo,
    agentName: agent.name,
    basis:
      kept.request.instruction === '' ? 'This conversation.' : 'What you asked for, and this conversation.',
  })
  const answered = { ...kept.request, draftIds: [...kept.request.draftIds, draft.id] }
  replaceRequest(world, answered)
  world.emit([viewerId], { type: 'draft.request.changed', request: answered })
}

const conversationFor = (
  world: World,
  viewerId: MemberId,
  wish: DraftWish,
): T.Task<ConversationId, ApiError> => {
  if (wish.inReplyTo === undefined)
    return T.map((room: { readonly id: ConversationId }) => room.id)(destinationOf(world, viewerId, wish))
  const records = world.records()
  return T.map((note: Note) => note.conversationId)(
    found(
      records.notes.find((note) => note.id === wish.inReplyTo && mayRead(records, viewerId, note)),
      'No such note.',
    ),
  )
}

const waitingRequest = (world: World, viewerId: MemberId, id: string): T.Task<DraftRequest, ApiError> =>
  T.flatMap((request: DraftRequest) =>
    request.cancelledAt !== null || request.expiresAt <= world.clock.now()
      ? T.fail(Conflict({ message: 'This draft request is no longer waiting.' }))
      : T.succeed(request),
  )(
    found(
      world.records().draftRequests.find((kept) => kept.memberId === viewerId && kept.request.id === id)
        ?.request,
      'No such draft request.',
    ),
  )

const replaceRequest = (world: World, request: DraftRequest): void =>
  world.update((records) => ({
    ...records,
    draftRequests: records.draftRequests.map((kept) =>
      kept.request.id === request.id ? { ...kept, request } : kept,
    ),
  }))

const DRAFT_REQUEST_LIFETIME_MS = 24 * 60 * 60_000

const REQUESTED_REPLY =
  'Thanks, I read this. I will check it against the migration plan this afternoon and write back here before the end of the day.'

const REQUESTED_NOTE =
  'A quick update from me: the billing migration is on track for tonight, after the nightly export. I will write here when it is done.'
