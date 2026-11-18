import { Task as T } from '@homingbird/kernel'
import {
  type Conversation,
  ConversationId,
  type ConversationKind,
  Forbidden,
  Invalid,
  type MemberId,
  NotFound,
  canMessage,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, insertInto, sql } from '../sql/query.ts'
import { tiesOf } from './contacts.ts'
import { membersByIds, messagingFacts } from './members.ts'
import { type NoteRow, hydrateNotes } from './note-rows.ts'
import { readSettings } from './settings.ts'

export const listConversations = (viewerId: MemberId): T.Task<Conversation[], never, AppEnv> =>
  T.gen(function* () {
    const rows = yield* all<ConversationRow>(sql`
      SELECT c.* FROM conversations c
      JOIN participants p ON p.conversation_id = c.id AND p.member_id = ${viewerId}
      WHERE c.kind <> 'dm'
         OR EXISTS (SELECT 1 FROM notes n WHERE n.conversation_id = c.id
                    AND (n.status = 'sent' OR (n.status = 'draft' AND n.author_id = ${viewerId})))
      ORDER BY c.last_activity_at DESC LIMIT ${CONVERSATION_LIMIT}`)
    return yield* T.forEach(rows, (row) => describeConversation(viewerId, row))
  })

export const conversationFor = (
  viewerId: MemberId,
  id: ConversationId,
): T.Task<Conversation, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* participatedConversation(viewerId, id)
    return yield* describeConversation(viewerId, row)
  })

export const participatedConversation = (
  viewerId: MemberId,
  id: ConversationId,
): T.Task<ConversationRow, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* first<ConversationRow>(sql`
      SELECT c.* FROM conversations c
      JOIN participants p ON p.conversation_id = c.id AND p.member_id = ${viewerId}
      WHERE c.id = ${id}`)
    return row ?? (yield* T.fail(NotFound({ message: 'No such conversation.' })))
  })

export const participantsOf = (id: ConversationId): T.Task<MemberId[], never, AppEnv> =>
  T.map((rows: ReadonlyArray<{ member_id: MemberId }>) => rows.map((row) => row.member_id))(
    all(sql`SELECT member_id FROM participants WHERE conversation_id = ${id} ORDER BY member_id`),
  )

export const directConversationWith = (
  viewerId: MemberId,
  otherId: MemberId,
): T.Task<ConversationRow, Forbidden | NotFound, AppEnv> =>
  T.gen(function* () {
    yield* requireMayMessage(viewerId, [otherId])
    const pairKey = [viewerId, otherId].sort().join(':')
    const existing = yield* first<ConversationRow>(
      sql`SELECT * FROM conversations WHERE pair_key = ${pairKey}`,
    )
    if (existing !== null) return existing
    const created = yield* insertConversation('dm', null, pairKey, [viewerId, otherId])
    return (
      (yield* first<ConversationRow>(sql`SELECT * FROM conversations WHERE pair_key = ${pairKey}`)) ?? created
    )
  })

export const createGroupConversation = (
  viewerId: MemberId,
  otherIds: ReadonlyArray<MemberId>,
  title: string | undefined,
): T.Task<Conversation, Forbidden | NotFound | Invalid, AppEnv> =>
  T.gen(function* () {
    const others = [...new Set(otherIds)].filter((id) => id !== viewerId)
    if (others.length === 0)
      return yield* T.fail(Invalid({ message: 'A conversation needs someone else in it.' }))
    if (others.length === 1)
      return yield* describeConversation(viewerId, yield* directConversationWith(viewerId, others[0]!))
    yield* requireMayMessage(viewerId, others)
    const row = yield* insertConversation('group', title ?? null, null, [viewerId, ...others])
    return yield* describeConversation(viewerId, row)
  })

export const requireMayMessage = (
  viewerId: MemberId,
  otherIds: ReadonlyArray<MemberId>,
): T.Task<void, Forbidden | NotFound, AppEnv> =>
  T.gen(function* () {
    const settings = yield* readSettings
    const ties = yield* tiesOf(viewerId)
    const members = yield* membersByIds(otherIds)
    for (const otherId of otherIds) {
      const other = members.get(otherId)
      if (other === undefined) return yield* T.fail(NotFound({ message: 'No such member.' }))
      if (!canMessage(messagingFacts(settings.contactMode, viewerId, other, ties)))
        return yield* T.fail(Forbidden({ message: `You cannot message ${other.name}.` }))
    }
  })

export interface ConversationRow {
  readonly id: ConversationId
  readonly kind: ConversationKind
  readonly title: string | null
  readonly created_at: number
  readonly last_activity_at: number
  readonly archived_at?: number | null
}

const CONVERSATION_LIMIT = 200

const describeConversation = (
  viewerId: MemberId,
  row: ConversationRow,
): T.Task<Conversation, never, AppEnv> =>
  T.gen(function* () {
    const participantIds = yield* participantsOf(row.id)
    const lastRow = yield* first<NoteRow>(
      sql`SELECT * FROM notes WHERE conversation_id = ${row.id} AND status = 'sent' ORDER BY sent_at DESC, id DESC LIMIT 1`,
    )
    const [lastNote] = yield* hydrateNotes(lastRow === null ? [] : [lastRow])
    const unread = yield* first<{ total: number }>(sql`
      SELECT COUNT(*) AS total FROM receipts r JOIN notes n ON n.id = r.note_id
      WHERE n.conversation_id = ${row.id} AND r.member_id = ${viewerId} AND r.read_at IS NULL AND r.replied_at IS NULL`)
    const drafts = yield* first<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM notes WHERE conversation_id = ${row.id} AND status = 'draft' AND author_id = ${viewerId}`,
    )
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      participantIds,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      lastNote: lastNote ?? null,
      unreadCount: Number(unread?.total ?? 0),
      draftCount: Number(drafts?.total ?? 0),
      archivedAt: row.archived_at ?? null,
    }
  })

const insertConversation = (
  kind: ConversationKind,
  title: string | null,
  pairKey: string | null,
  participantIds: ReadonlyArray<MemberId>,
): T.Task<ConversationRow, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const now = env.clock.now()
    const row: ConversationRow = {
      id: ConversationId.of(env.random.identifier()),
      kind,
      title,
      created_at: now,
      last_activity_at: now,
    }
    const inserted = yield* run(
      insertIgnoringConflict(yield* dialect, 'conversations', { ...row, pair_key: pairKey }),
    )
    if (inserted === 0) return row
    for (const memberId of participantIds)
      yield* run(insertInto('participants', { conversation_id: row.id, member_id: memberId }))
    return row
  })
