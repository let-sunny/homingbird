import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type ConversationId,
  type CredentialId,
  type DraftRequest,
  DraftRequestId,
  Forbidden,
  type MemberId,
  NotFound,
  type Note,
  type NoteId,
} from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, list, sql } from '../sql/query.ts'
import { type DraftDestination, type NoteFailure, conversationForDraft, createDraft } from './notes.ts'
import { forgetNotice } from './notices.ts'

export interface DraftWish extends DraftDestination {
  readonly instruction?: string
  readonly agentId?: CredentialId
}

export const requestDraft = (
  caller: Caller,
  wish: DraftWish,
): T.Task<DraftRequest, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Only a person can ask their agents for a draft.' }))
    const memberId = caller.member.id
    const conversationId = yield* conversationForDraft(memberId, wish)
    if (wish.agentId !== undefined) yield* requireOwnAgent(memberId, wish.agentId)
    yield* requireRoomForAnotherRequest(memberId)
    const now = env.clock.now()
    const row: DraftRequestRow = {
      id: DraftRequestId.of(env.random.identifier()),
      member_id: memberId,
      conversation_id: conversationId,
      in_reply_to: wish.inReplyTo ?? null,
      instruction: wish.instruction ?? '',
      agent_id: wish.agentId ?? null,
      created_at: now,
      expires_at: now + DRAFT_REQUEST_LIFETIME_MS,
      cancelled_at: null,
    }
    yield* run(insertInto('draft_requests', { ...row }))
    if (row.in_reply_to !== null) yield* forgetNotice(memberId, row.in_reply_to)
    const request = yield* requestById(row.id)
    yield* emit([memberId], { type: 'draft.requested', request })
    return request
  })

export const answerDraftRequest = (
  caller: Caller,
  id: DraftRequestId,
  draft: { readonly body: string; readonly basis?: string },
): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* waitingRequest(caller.member.id, id)
    if (row.agent_id !== null && !isHuman(caller) && row.agent_id !== caller.credential.id)
      return yield* T.fail(Conflict({ message: 'This request was addressed to another agent.' }))
    const created = yield* createDraft(
      caller,
      row.in_reply_to === null
        ? { ...draft, conversationId: row.conversation_id }
        : { ...draft, inReplyTo: row.in_reply_to },
    )
    yield* run(
      insertInto('draft_request_answers', {
        request_id: id,
        note_id: created.id,
        credential_id: caller.credential.id,
      }),
    )
    yield* announceChange(caller.member.id, id)
    return created
  })

export const cancelDraftRequest = (
  caller: Caller,
  id: DraftRequestId,
): T.Task<DraftRequest, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Only a person can withdraw a draft request.' }))
    yield* waitingRequest(caller.member.id, id)
    yield* run(sql`UPDATE draft_requests SET cancelled_at = ${env.clock.now()} WHERE id = ${id}`)
    return yield* announceChange(caller.member.id, id)
  })

export const openDraftRequests = (caller: Caller): T.Task<DraftRequest[], never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const credentialId = caller.credential.id
    const stillWantedFromThisAgent = isHuman(caller)
      ? sql``
      : sql`AND (d.agent_id IS NULL OR d.agent_id = ${credentialId})
        AND NOT EXISTS (
          SELECT 1 FROM draft_request_answers a JOIN notes n ON n.id = a.note_id
          WHERE a.request_id = d.id AND (a.credential_id = ${credentialId} OR n.status = 'sent'))`
    const rows = yield* all<DraftRequestRow>(sql`
      SELECT d.* FROM draft_requests d
      WHERE d.member_id = ${caller.member.id} AND d.cancelled_at IS NULL AND d.expires_at > ${env.clock.now()}
      ${stillWantedFromThisAgent} ORDER BY d.created_at, d.id`)
    return yield* hydrate(rows)
  })

export const DRAFT_REQUEST_LIFETIME_MS = 24 * 60 * 60_000
export const MAX_OPEN_DRAFT_REQUESTS = 50

interface DraftRequestRow {
  readonly id: DraftRequestId
  readonly member_id: MemberId
  readonly conversation_id: ConversationId
  readonly in_reply_to: NoteId | null
  readonly instruction: string
  readonly agent_id: CredentialId | null
  readonly created_at: number
  readonly expires_at: number
  readonly cancelled_at: number | null
}

const waitingRequest = (
  memberId: MemberId,
  id: DraftRequestId,
): T.Task<DraftRequestRow, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const row = yield* first<DraftRequestRow>(
      sql`SELECT * FROM draft_requests WHERE id = ${id} AND member_id = ${memberId}`,
    )
    if (row === null) return yield* T.fail(NotFound({ message: 'No such draft request.' }))
    if (row.cancelled_at !== null || Number(row.expires_at) <= env.clock.now())
      return yield* T.fail(Conflict({ message: 'This draft request is no longer waiting.' }))
    return row
  })

const requireOwnAgent = (memberId: MemberId, agentId: CredentialId): T.Task<void, NotFound, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const agent = yield* first(sql`
      SELECT id FROM credentials WHERE id = ${agentId} AND member_id = ${memberId} AND kind = 'agent'
      AND revoked_at IS NULL AND expires_at > ${env.clock.now()}`)
    if (agent === null) return yield* T.fail(NotFound({ message: 'No such connected agent.' }))
  })

const requireRoomForAnotherRequest = (memberId: MemberId): T.Task<void, Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const open = yield* first<{ total: number }>(sql`
      SELECT COUNT(*) AS total FROM draft_requests
      WHERE member_id = ${memberId} AND cancelled_at IS NULL AND expires_at > ${env.clock.now()}`)
    if (Number(open?.total ?? 0) >= MAX_OPEN_DRAFT_REQUESTS)
      return yield* T.fail(Conflict({ message: 'Too many draft requests are waiting. Withdraw some first.' }))
  })

const announceChange = (memberId: MemberId, id: DraftRequestId): T.Task<DraftRequest, never, RequestEnv> =>
  T.gen(function* () {
    const request = yield* requestById(id)
    yield* emit([memberId], { type: 'draft.request.changed', request })
    return request
  })

const requestById = (id: DraftRequestId): T.Task<DraftRequest, never, RequestEnv> =>
  T.gen(function* () {
    const rows = yield* all<DraftRequestRow>(sql`SELECT * FROM draft_requests WHERE id = ${id}`)
    return (yield* hydrate(rows))[0]!
  })

const hydrate = (rows: ReadonlyArray<DraftRequestRow>): T.Task<DraftRequest[], never, RequestEnv> =>
  T.gen(function* () {
    if (rows.length === 0) return []
    const answers = yield* all<{ request_id: DraftRequestId; note_id: NoteId }>(sql`
      SELECT a.request_id, a.note_id FROM draft_request_answers a JOIN notes n ON n.id = a.note_id
      WHERE a.request_id IN ${list(rows.map((row) => row.id))} ORDER BY n.created_at, n.id`)
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      inReplyTo: row.in_reply_to,
      instruction: row.instruction,
      agentId: row.agent_id,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      cancelledAt: row.cancelled_at === null ? null : Number(row.cancelled_at),
      draftIds: answers.filter((answer) => answer.request_id === row.id).map((answer) => answer.note_id),
    }))
  })
