import { Task as T } from '@homingbird/kernel'
import {
  type ConversationId,
  type DraftPreview,
  type DraftPreviewAllowance,
  Invalid,
  type MemberId,
  NO_DRAFT_PREVIEWS,
  type NotFound,
  isPerson,
  previewViewers,
} from '@homingbird/protocol'
import type { AppEnv, Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, list, sql } from '../sql/query.ts'
import { channelRow, isMemberOf, membersOf } from './channel-rows.ts'
import { participantsOf, participatedConversation } from './conversations.ts'
import { membersByIds } from './members.ts'
import type { NoteRow } from './note-rows.ts'
import { featureIsOn } from './settings.ts'

/**
 * The unconfirmed drafts of other people's agents that this person may see in a conversation, and the
 * ones withdrawn while they could: never the person's own, a channel's agent's, a hand-written draft or
 * a debate room's result. Read through a person's route only, so no agent credential ever gets one.
 */
export const previewsFor = (
  viewerId: MemberId,
  conversationId: ConversationId,
): T.Task<DraftPreview[], NotFound, AppEnv> =>
  T.gen(function* () {
    yield* participatedConversation(viewerId, conversationId)
    if (!(yield* featureIsOn('draftPreviews'))) return []
    const rows = yield* all<NoteRow>(sql`
      SELECT n.* FROM notes n JOIN members m ON m.id = n.author_id
      WHERE n.conversation_id = ${conversationId} AND n.author_id <> ${viewerId}
        AND m.kind = 'person' AND n.agent_name IS NOT NULL AND n.debate_id IS NULL
        AND (n.status = 'draft' OR (n.status = 'discarded' AND n.preview_withdrawn_at IS NOT NULL))
      ORDER BY n.created_at, n.id`)
    if (rows.length === 0) return []
    const place = yield* placeOf(conversationId)
    const shown: DraftPreview[] = []
    for (const row of rows) {
      const allowance = yield* draftPreviewAllowanceOf(row.author_id)
      if (previewViewers(allowance, row.author_id, place).includes(viewerId)) shown.push(toPreview(row))
    }
    return shown
  })

export const draftPreviewAllowanceOf = (memberId: MemberId): T.Task<DraftPreviewAllowance, never, AppEnv> =>
  T.gen(function* () {
    const rows = yield* all<AllowanceRow>(sql`
      SELECT a.kind, a.target_id, c.slug FROM draft_preview_allowances a
      LEFT JOIN channels c ON a.kind = 'channel' AND c.conversation_id = a.target_id
      WHERE a.member_id = ${memberId} ORDER BY a.created_at, a.target_id`)
    if (rows.length === 0) return NO_DRAFT_PREVIEWS
    return {
      people: rows.filter((row) => row.kind === 'person').map((row) => row.target_id as MemberId),
      channels: rows.flatMap((row) => (row.kind === 'channel' && row.slug !== null ? [row.slug] : [])),
    }
  })

/**
 * Replaces whom the person lets see their agent's unconfirmed drafts: active people other than
 * themself, and channels whose room they are in. Everyone who gains or loses a view is told to look again.
 */
export const allowDraftPreviews = (
  caller: Caller,
  allowance: DraftPreviewAllowance,
): T.Task<DraftPreviewAllowance, Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const memberId = caller.member.id
    const people = [...new Set(allowance.people)]
    const rooms = yield* roomsOf(memberId, [...new Set(allowance.channels)])
    yield* requireAllowablePeople(memberId, people)
    const before = yield* allowedViewers(memberId)
    yield* run(sql`DELETE FROM draft_preview_allowances WHERE member_id = ${memberId}`)
    const now = env.clock.now()
    for (const [kind, targetId] of [
      ...people.map((id) => ['person', id] as const),
      ...rooms.map((id) => ['channel', id] as const),
    ])
      yield* run(
        insertInto('draft_preview_allowances', {
          member_id: memberId,
          kind,
          target_id: targetId,
          created_at: now,
        }),
      )
    const after = yield* allowedViewers(memberId)
    tellToLookAgain(env, [...before, ...after], null)
    return yield* draftPreviewAllowanceOf(memberId)
  })

/** Tells whoever may see this draft's preview that it changed; nothing when previews are off. */
export const announcePreview = (
  draft: Pick<NoteRow, 'author_id' | 'conversation_id' | 'agent_name' | 'debate_id'>,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    tellToLookAgain(env, yield* viewersOfDraft(draft), draft.conversation_id)
  })

/**
 * Called as an agent's draft is discarded: when someone could see it, its place stays and says it was
 * withdrawn, without its words, and they are told.
 */
export const withdrawPreview = (draft: NoteRow): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const viewers = yield* viewersOfDraft(draft)
    if (viewers.length === 0) return
    yield* run(sql`UPDATE notes SET preview_withdrawn_at = ${env.clock.now()} WHERE id = ${draft.id}`)
    tellToLookAgain(env, viewers, draft.conversation_id)
  })

interface AllowanceRow {
  readonly kind: string
  readonly target_id: string
  readonly slug: string | null
}

const viewersOfDraft = (
  draft: Pick<NoteRow, 'author_id' | 'conversation_id' | 'agent_name' | 'debate_id'>,
): T.Task<MemberId[], never, AppEnv> =>
  T.gen(function* () {
    if (draft.agent_name === null || draft.debate_id !== null) return []
    if (!(yield* featureIsOn('draftPreviews'))) return []
    const allowance = yield* draftPreviewAllowanceOf(draft.author_id)
    if (allowance.people.length === 0 && allowance.channels.length === 0) return []
    const place = yield* placeOf(draft.conversation_id)
    const members = yield* membersByIds([draft.author_id, ...place.participantIds])
    const author = members.get(draft.author_id)
    if (author === undefined || !isPerson(author)) return []
    return previewViewers(allowance, draft.author_id, place).filter((id) => {
      const viewer = members.get(id)
      return viewer !== undefined && isPerson(viewer)
    })
  })

const placeOf = (conversationId: ConversationId) =>
  T.gen(function* () {
    const room = yield* first<{ kind: string; channel_id: string | null; slug: string | null }>(sql`
      SELECT c.kind, c.channel_id, t.slug FROM conversations c
      LEFT JOIN channels t ON t.conversation_id = c.id WHERE c.id = ${conversationId}`)
    return {
      kind: room?.kind ?? 'unknown',
      participantIds: yield* participantsOf(conversationId),
      channel: room?.slug ?? null,
      isPrivateQuestion: (room?.channel_id ?? null) !== null,
    }
  })

/** Everyone who could see some preview of this person's: the allowed people and the allowed rooms' people. */
const allowedViewers = (memberId: MemberId): T.Task<MemberId[], never, AppEnv> =>
  T.gen(function* () {
    const rows = yield* all<{ kind: string; target_id: string }>(
      sql`SELECT kind, target_id FROM draft_preview_allowances WHERE member_id = ${memberId}`,
    )
    const viewers = rows.filter((row) => row.kind === 'person').map((row) => row.target_id as MemberId)
    for (const row of rows.filter((each) => each.kind === 'channel'))
      viewers.push(...(yield* membersOf(row.target_id as ConversationId)))
    return viewers.filter((id) => id !== memberId)
  })

const roomsOf = (
  memberId: MemberId,
  slugs: ReadonlyArray<string>,
): T.Task<ConversationId[], Invalid, AppEnv> =>
  T.gen(function* () {
    const rooms: ConversationId[] = []
    for (const slug of slugs) {
      const row = yield* channelRow(slug)
      if (row === null || !(yield* isMemberOf(row.conversation_id, memberId)))
        return yield* T.fail(Invalid({ message: `Join #${slug} before letting it see your agent’s drafts.` }))
      rooms.push(row.conversation_id)
    }
    return rooms
  })

const requireAllowablePeople = (
  memberId: MemberId,
  people: ReadonlyArray<MemberId>,
): T.Task<void, Invalid, AppEnv> =>
  T.gen(function* () {
    if (people.includes(memberId))
      return yield* T.fail(Invalid({ message: 'You always see your own drafts.' }))
    if (people.length === 0) return
    const active = yield* all<{ id: MemberId }>(
      sql`SELECT id FROM members WHERE id IN ${list(people)} AND status = 'active' AND kind = 'person'`,
    )
    if (active.length !== people.length)
      return yield* T.fail(
        Invalid({ message: 'Only people in this organization can see your agent’s drafts.' }),
      )
  })

const tellToLookAgain = (
  env: RequestEnv,
  viewers: ReadonlyArray<MemberId>,
  conversationId: ConversationId | null,
): void => {
  for (const memberId of new Set(viewers))
    env.outbox.push({
      memberId,
      event: { seq: 0, at: env.clock.now(), body: { type: 'preview.changed', conversationId } },
    })
}

const toPreview = (row: NoteRow): DraftPreview => {
  const withdrawn = row.status !== 'draft'
  return {
    noteId: row.id,
    conversationId: row.conversation_id,
    authorId: row.author_id,
    agentName: row.agent_name,
    inReplyTo: row.in_reply_to,
    state: withdrawn ? 'withdrawn' : 'unconfirmed',
    body: withdrawn ? null : row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
