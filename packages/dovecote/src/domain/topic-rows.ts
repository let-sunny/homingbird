import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type ConversationId,
  type Member,
  type MemberId,
  NotFound,
  type Topic,
  type TopicVisibility,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, sql } from '../sql/query.ts'
import { abandonDraftsIn } from './abandoned-drafts.ts'

export type Viewer = Pick<Member, 'id' | 'role'>

export interface TopicRow {
  readonly slug: string
  readonly description: string
  readonly conversation_id: ConversationId
  readonly visibility: TopicVisibility | null
  readonly created_at: number
}

export const visibleTopic = (viewer: Viewer, slug: string): T.Task<TopicRow, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* topicRow(slug)
    if (row === null || !(yield* maySee(viewer, row))) return yield* T.fail(noSuchTopic(slug))
    return row
  })

export const describeTopic = (viewer: Viewer, row: TopicRow): T.Task<Topic, never, AppEnv> =>
  T.gen(function* () {
    const members = yield* membersOf(row.conversation_id)
    const helpers = yield* helpersOf(row.conversation_id)
    const managers = yield* managersOf(row.conversation_id)
    const joined = members.includes(viewer.id)
    return {
      slug: row.slug,
      description: row.description,
      conversationId: row.conversation_id,
      visibility: visibilityOf(row),
      memberCount: members.length,
      helperCount: helpers.length,
      joined,
      answering: helpers.includes(viewer.id),
      managing: (joined && managers.includes(viewer.id)) || viewer.role === 'admin',
      createdAt: Number(row.created_at),
    }
  })

export const maySee = (viewer: Viewer, row: TopicRow): T.Task<boolean, never, AppEnv> =>
  visibilityOf(row) === 'open' || viewer.role === 'admin'
    ? T.succeed(true)
    : isMemberOf(row.conversation_id, viewer.id)

export const visibilityOf = (row: TopicRow): TopicVisibility => row.visibility ?? 'open'

export const topicRow = (slug: string): T.Task<TopicRow | null, never, AppEnv> =>
  first<TopicRow>(sql`SELECT * FROM topics WHERE slug = ${slug}`)

export const topicOfRoom = (conversationId: ConversationId): T.Task<TopicRow | null, never, AppEnv> =>
  first<TopicRow>(sql`SELECT * FROM topics WHERE conversation_id = ${conversationId}`)

export const existingTopic = (slug: string): T.Task<TopicRow, NotFound, AppEnv> =>
  T.flatMap((row: TopicRow | null) => (row === null ? T.fail(noSuchTopic(slug)) : T.succeed(row)))(
    topicRow(slug),
  )

export const noSuchTopic = (slug: string): NotFound => NotFound({ message: `No such topic: ${slug}.` })

export const isMemberOf = (
  conversationId: ConversationId,
  memberId: MemberId,
): T.Task<boolean, never, AppEnv> =>
  T.map((row: unknown) => row !== null)(
    first(
      sql`SELECT 1 AS present FROM participants WHERE conversation_id = ${conversationId} AND member_id = ${memberId}`,
    ),
  )

export const membersOf = (conversationId: ConversationId): T.Task<MemberId[], never, AppEnv> =>
  idsOf(sql`
    SELECT p.member_id FROM participants p JOIN members m ON m.id = p.member_id
    WHERE p.conversation_id = ${conversationId} AND m.status = 'active' ORDER BY p.member_id`)

export const helpersOf = (conversationId: ConversationId): T.Task<MemberId[], never, AppEnv> =>
  idsOf(sql`
    SELECT h.member_id FROM topic_helpers h JOIN members m ON m.id = h.member_id
    WHERE h.conversation_id = ${conversationId} AND m.status = 'active' ORDER BY h.member_id`)

export const managersOf = (conversationId: ConversationId): T.Task<MemberId[], never, AppEnv> =>
  idsOf(sql`
    SELECT g.member_id FROM topic_managers g
    JOIN participants p ON p.conversation_id = g.conversation_id AND p.member_id = g.member_id
    WHERE g.conversation_id = ${conversationId} ORDER BY g.member_id`)

export const enter = (conversationId: ConversationId, memberId: MemberId): T.Task<void, never, AppEnv> =>
  addTo('participants', conversationId, memberId)

export const startAnswering = (
  conversationId: ConversationId,
  memberId: MemberId,
): T.Task<void, never, AppEnv> => addTo('topic_helpers', conversationId, memberId)

export const makeManager = (
  conversationId: ConversationId,
  memberId: MemberId,
): T.Task<void, never, AppEnv> => addTo('topic_managers', conversationId, memberId)

export const depart = (row: TopicRow, memberId: MemberId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const room = row.conversation_id
    yield* run(sql`DELETE FROM topic_helpers WHERE conversation_id = ${room} AND member_id = ${memberId}`)
    yield* run(sql`DELETE FROM topic_managers WHERE conversation_id = ${room} AND member_id = ${memberId}`)
    yield* run(sql`DELETE FROM participants WHERE conversation_id = ${room} AND member_id = ${memberId}`)
    yield* abandonDraftsIn(room, memberId)
    yield* emit([memberId], { type: 'topic.left', slug: row.slug, conversationId: room })
  })

export const requireManagerRemains = (
  row: TopicRow,
  change: { readonly leaving?: MemberId; readonly steppingDown?: MemberId },
): T.Task<void, Conflict, AppEnv> =>
  T.gen(function* () {
    const managers = yield* managersOf(row.conversation_id)
    if (managers.length === 0) return
    const members = (yield* membersOf(row.conversation_id)).filter((id) => id !== change.leaving)
    const remaining = managers.filter((id) => id !== change.leaving && id !== change.steppingDown)
    if (members.length > 0 && remaining.length === 0)
      return yield* T.fail(
        Conflict({ message: 'Make another member a manager first: a topic with members keeps a manager.' }),
      )
  })

export const tellAboutTopic = (
  row: TopicRow,
  recipients: Iterable<MemberId>,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    for (const memberId of new Set(recipients)) {
      const viewer = yield* first<Viewer>(sql`SELECT id, role FROM members WHERE id = ${memberId}`)
      if (viewer === null) continue
      yield* emit([memberId], { type: 'topic.changed', topic: yield* describeTopic(viewer, row) })
    }
  })

const addTo = (
  table: 'participants' | 'topic_helpers' | 'topic_managers',
  conversationId: ConversationId,
  memberId: MemberId,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    yield* run(
      insertIgnoringConflict(yield* dialect, table, { conversation_id: conversationId, member_id: memberId }),
    )
  })

const idsOf = (query: ReturnType<typeof sql>): T.Task<MemberId[], never, AppEnv> =>
  T.map((rows: ReadonlyArray<{ member_id: MemberId }>) => rows.map((row) => row.member_id))(all(query))
