import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
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
import { type Query, insertIgnoringConflict, insertInto, sql } from '../sql/query.ts'
import { tiesOf } from './contacts.ts'
import { membersByIds, messagingFacts } from './members.ts'
import { type NoteRow, hydrateNotes } from './note-rows.ts'
import { featureIsOn, readSettings } from './settings.ts'

/**
 * The viewer's conversations. A mute is a person's own setting, so it is shown only to the person
 * themself, never to their agent's credential.
 */
export const listConversations = (
  viewerId: MemberId,
  forPerson: boolean,
): T.Task<Conversation[], never, AppEnv> =>
  T.gen(function* () {
    const rows = yield* all<ConversationRow>(sql`
      SELECT c.* FROM conversations c
      JOIN participants p ON p.conversation_id = c.id AND p.member_id = ${viewerId}
      WHERE ${isShownTo(viewerId)}
      ORDER BY c.last_activity_at DESC LIMIT ${CONVERSATION_LIMIT}`)
    const muting = yield* showsMute(forPerson)
    return yield* T.forEach(rows, (row) => describeConversation(viewerId, row, muting))
  })

export const conversationFor = (
  viewerId: MemberId,
  id: ConversationId,
  forPerson: boolean,
): T.Task<Conversation, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* participatedConversation(viewerId, id)
    return yield* describeConversation(viewerId, row, yield* showsMute(forPerson))
  })

export const participatedConversation = (
  viewerId: MemberId,
  id: ConversationId,
): T.Task<ConversationRow, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* first<ConversationRow>(sql`
      SELECT c.* FROM conversations c
      JOIN participants p ON p.conversation_id = c.id AND p.member_id = ${viewerId}
      WHERE c.id = ${id} AND (c.kind = 'direct' OR ${isShownTo(viewerId)})`)
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
    const created = yield* insertConversation('direct', null, pairKey, null, [viewerId, otherId])
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
    const muting = yield* featureIsOn('mute')
    if (others.length === 1)
      return yield* describeConversation(
        viewerId,
        yield* directConversationWith(viewerId, others[0]!),
        muting,
      )
    yield* requireMayMessage(viewerId, others)
    const row = yield* insertConversation('group', title ?? null, null, viewerId, [viewerId, ...others])
    return yield* describeConversation(viewerId, row, muting)
  })

const requireMayMessage = (
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

/** Whether the author may write in this conversation now: not archived, and in a direct one, not blocked. */
export const requireMayMessageIn = (
  authorId: MemberId,
  conversationId: ConversationId,
): T.Task<void, NotFound | Forbidden | Conflict, AppEnv> =>
  T.gen(function* () {
    const conversation = yield* participatedConversation(authorId, conversationId)
    if ((conversation.archived_at ?? null) !== null) return yield* T.fail(ARCHIVED)
    if (conversation.kind !== 'direct') return
    const others = (yield* participantsOf(conversationId)).filter((memberId) => memberId !== authorId)
    yield* requireMayMessage(authorId, others)
  })

export interface ConversationRow {
  readonly id: ConversationId
  readonly kind: ConversationKind
  readonly title: string | null
  readonly created_at: number
  readonly last_activity_at: number
  readonly archived_at?: number | null
  readonly channel_id?: ConversationId | null
  readonly asked_by?: MemberId | null
}

const CONVERSATION_LIMIT = 200
const ARCHIVED = Conflict({
  message:
    'No reply is possible: this channel was archived. It can still be read, but nothing more can be written in it, here or in the web client.',
})

/**
 * Whether the viewer may see this conversation. A direct or group conversation shows only once a note
 * in it is sent, and before that to the author of a draft in it and to whoever started the group;
 * channel rooms, private questions and archived rooms always show to their participants. `c` names
 * the conversation in the query.
 */
const isShownTo = (viewerId: MemberId): Query => sql`(
  c.kind = 'channel' OR c.channel_id IS NOT NULL OR c.archived_at IS NOT NULL OR c.asked_by = ${viewerId}
  OR EXISTS (SELECT 1 FROM notes n WHERE n.conversation_id = c.id
             AND (n.status = 'sent' OR (n.status = 'draft' AND n.author_id = ${viewerId}))))`

const showsMute = (forPerson: boolean): T.Task<boolean, never, AppEnv> =>
  forPerson ? featureIsOn('mute') : T.succeed(false)

const describeConversation = (
  viewerId: MemberId,
  row: ConversationRow,
  muting: boolean,
): T.Task<Conversation, never, AppEnv> =>
  T.gen(function* () {
    const participantIds = yield* participantsOf(row.id)
    const lastRow = yield* first<NoteRow>(
      sql`SELECT * FROM notes WHERE conversation_id = ${row.id} AND status = 'sent' ORDER BY sent_at DESC, id DESC LIMIT 1`,
    )
    const [lastNote] = yield* hydrateNotes(lastRow === null ? [] : [lastRow], null)
    const unread = yield* first<{ total: number }>(sql`
      SELECT COUNT(*) AS total FROM receipts r JOIN notes n ON n.id = r.note_id
      WHERE n.conversation_id = ${row.id} AND r.member_id = ${viewerId} AND r.read_at IS NULL AND r.replied_at IS NULL`)
    const drafts = yield* first<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM notes WHERE conversation_id = ${row.id} AND status = 'draft' AND author_id = ${viewerId}`,
    )
    const channelRoom = row.channel_id ?? null
    const askedOf = channelRoom === null ? null : yield* channelSlugOfRoom(channelRoom)
    const managedFrom = row.kind === 'channel' ? row.id : channelRoom
    const managerIds = managedFrom === null ? null : yield* managersIn(row.id, managedFrom)
    const place = muting
      ? yield* first<{ muted_at: number | null }>(
          sql`SELECT muted_at FROM participants WHERE conversation_id = ${row.id} AND member_id = ${viewerId}`,
        )
      : null
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
      ...(channelRoom !== null && { privateQuestionOf: askedOf }),
      ...(channelRoom !== null && row.asked_by != null && { askedBy: row.asked_by }),
      ...(managerIds !== null && { managerIds }),
      ...(muting && { muted: (place?.muted_at ?? null) !== null }),
    }
  })

/** Who of this conversation's participants manages the channel whose room is given. */
const managersIn = (
  conversationId: ConversationId,
  channelRoom: ConversationId,
): T.Task<MemberId[], never, AppEnv> =>
  T.map((rows: ReadonlyArray<{ member_id: MemberId }>) => rows.map((row) => row.member_id))(
    all(sql`
      SELECT g.member_id FROM channels ch
      JOIN group_members g ON g.group_id = ch.manager_group_id
      JOIN members m ON m.id = g.member_id AND m.status = 'active' AND m.kind = 'person'
      JOIN participants p ON p.conversation_id = ${conversationId} AND p.member_id = g.member_id
      WHERE ch.conversation_id = ${channelRoom} ORDER BY g.member_id`),
  )

/** The slug of the channel whose room this is, or null once it was archived. */
const channelSlugOfRoom = (conversationId: ConversationId): T.Task<string | null, never, AppEnv> =>
  T.map((row: { slug: string } | null) => row?.slug ?? null)(
    first<{ slug: string }>(sql`SELECT slug FROM channels WHERE conversation_id = ${conversationId}`),
  )

const insertConversation = (
  kind: ConversationKind,
  title: string | null,
  pairKey: string | null,
  startedBy: MemberId | null,
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
      insertIgnoringConflict(yield* dialect, 'conversations', {
        ...row,
        pair_key: pairKey,
        // asked_by names a group's starter here and a private question's asker where channel_id is set,
        // so every reader of asked_by must check channel_id first.
        asked_by: startedBy,
      }),
    )
    if (inserted === 0) return row
    for (const memberId of participantIds)
      yield* run(insertInto('participants', { conversation_id: row.id, member_id: memberId }))
    return row
  })
