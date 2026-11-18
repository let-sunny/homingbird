import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  ConversationId,
  GENERAL_TOPIC,
  type MemberId,
  NotFound,
  type Topic,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { containsIgnoringCase, insertIgnoringConflict, insertInto, list, sql } from '../sql/query.ts'

export const listTopics = (viewerId: MemberId, search: string | undefined): T.Task<Topic[], never, AppEnv> =>
  T.gen(function* () {
    const rows = yield* all<TopicRow>(
      search
        ? sql`SELECT * FROM topics WHERE ${containsIgnoringCase('slug', search)} OR ${containsIgnoringCase('description', search)} ORDER BY slug`
        : sql`SELECT * FROM topics ORDER BY slug`,
    )
    return yield* T.forEach(rows, (row) => describe(viewerId, row))
  })

export const createTopic = (
  creatorId: MemberId,
  topic: { readonly slug: string; readonly description: string },
): T.Task<Topic, Conflict | NotFound, AppEnv> =>
  T.gen(function* () {
    if ((yield* topicRow(topic.slug)) !== null)
      return yield* T.fail(Conflict({ message: `The topic ${topic.slug} already exists.` }))
    yield* openRoom(topic, creatorId)
    return yield* startHelping(creatorId, topic.slug)
  })

export const startHelping = (memberId: MemberId, slug: string): T.Task<Topic, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* existingTopic(slug)
    yield* enter(row.conversation_id, memberId)
    yield* run(
      insertIgnoringConflict(yield* dialect, 'topic_helpers', {
        conversation_id: row.conversation_id,
        member_id: memberId,
      }),
    )
    return yield* describe(memberId, row)
  })

export const stopHelping = (memberId: MemberId, slug: string): T.Task<Topic, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* existingTopic(slug)
    yield* run(
      sql`DELETE FROM topic_helpers WHERE conversation_id = ${row.conversation_id} AND member_id = ${memberId}`,
    )
    yield* run(
      sql`DELETE FROM participants WHERE conversation_id = ${row.conversation_id} AND member_id = ${memberId}`,
    )
    return yield* describe(memberId, row)
  })

export const topicRoomFor = (askerId: MemberId, slug: string): T.Task<ConversationId, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* existingTopic(slug)
    yield* enter(row.conversation_id, askerId)
    return row.conversation_id
  })

export const helpersOf = (conversationId: ConversationId): T.Task<MemberId[], never, AppEnv> =>
  T.map((rows: ReadonlyArray<{ member_id: MemberId }>) => rows.map((row) => row.member_id))(
    all(sql`
      SELECT h.member_id FROM topic_helpers h JOIN members m ON m.id = h.member_id
      WHERE h.conversation_id = ${conversationId} AND m.status = 'active' ORDER BY h.member_id`),
  )

export const topicsHelpedBy = (
  memberIds: ReadonlyArray<MemberId>,
): T.Task<Map<MemberId, string[]>, never, AppEnv> =>
  T.gen(function* () {
    const helped = new Map<MemberId, string[]>()
    if (memberIds.length === 0) return helped
    const rows = yield* all<{ member_id: MemberId; slug: string }>(sql`
      SELECT h.member_id, t.slug FROM topic_helpers h JOIN topics t ON t.conversation_id = h.conversation_id
      WHERE h.member_id IN ${list([...new Set(memberIds)])} ORDER BY t.slug`)
    for (const row of rows) helped.set(row.member_id, [...(helped.get(row.member_id) ?? []), row.slug])
    return helped
  })

export const reviseTopic = (
  viewerId: MemberId,
  slug: string,
  changes: { readonly slug?: string; readonly description?: string },
): T.Task<Topic, NotFound | Conflict, AppEnv> =>
  T.gen(function* () {
    const row = yield* existingTopic(slug)
    const renamed = changes.slug ?? slug
    if (renamed !== slug) {
      yield* requireNotGeneral(slug)
      if ((yield* topicRow(renamed)) !== null)
        return yield* T.fail(Conflict({ message: `The topic ${renamed} already exists.` }))
    }
    yield* run(
      sql`UPDATE topics SET slug = ${renamed}, description = ${changes.description ?? row.description} WHERE slug = ${slug}`,
    )
    yield* run(sql`UPDATE conversations SET title = ${renamed} WHERE id = ${row.conversation_id}`)
    return yield* describe(viewerId, yield* existingTopic(renamed))
  })

export const removeTopic = (slug: string): T.Task<void, NotFound | Conflict, AppEnv> =>
  T.gen(function* () {
    yield* requireNotGeneral(slug)
    const row = yield* existingTopic(slug)
    yield* run(sql`DELETE FROM topic_helpers WHERE conversation_id = ${row.conversation_id}`)
    yield* run(sql`DELETE FROM topics WHERE slug = ${slug}`)
    yield* run(
      sql`UPDATE conversations SET kind = 'group', title = ${archivedTitle(slug)} WHERE id = ${row.conversation_id}`,
    )
  })

export const mergeTopic = (
  viewerId: MemberId,
  slug: string,
  intoSlug: string,
): T.Task<Topic, NotFound | Conflict, AppEnv> =>
  T.gen(function* () {
    if (slug === intoSlug)
      return yield* T.fail(Conflict({ message: 'A topic cannot be merged into itself.' }))
    const from = yield* existingTopic(slug)
    const into = yield* existingTopic(intoSlug)
    const target = yield* dialect
    for (const table of ['participants', 'topic_helpers'] as const) {
      const moving = yield* all<{ member_id: MemberId }>(
        table === 'participants'
          ? sql`SELECT member_id FROM participants WHERE conversation_id = ${from.conversation_id}`
          : sql`SELECT member_id FROM topic_helpers WHERE conversation_id = ${from.conversation_id}`,
      )
      for (const { member_id } of moving)
        yield* run(
          insertIgnoringConflict(target, table, { conversation_id: into.conversation_id, member_id }),
        )
    }
    yield* removeTopic(slug)
    return yield* describe(viewerId, into)
  })

export const seedTopics: T.Task<void, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  for (const topic of env.config.topics) {
    if ((yield* topicRow(topic.slug)) !== null) continue
    yield* openRoom(topic, null)
    if (topic.slug !== GENERAL_TOPIC) continue
    const members = yield* all<{ id: MemberId }>(sql`SELECT id FROM members WHERE status = 'active'`)
    for (const member of members) yield* T.orDie(startHelping(member.id, GENERAL_TOPIC))
  }
})

export const joinGeneralTopic = (memberId: MemberId): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    if ((yield* topicRow(GENERAL_TOPIC)) !== null) yield* T.orDie(startHelping(memberId, GENERAL_TOPIC))
  })

interface TopicRow {
  readonly slug: string
  readonly description: string
  readonly conversation_id: ConversationId
  readonly created_at: number
}

const archivedTitle = (slug: string): string => `${slug} (archived)`

const topicRow = (slug: string): T.Task<TopicRow | null, never, AppEnv> =>
  first<TopicRow>(sql`SELECT * FROM topics WHERE slug = ${slug}`)

const existingTopic = (slug: string): T.Task<TopicRow, NotFound, AppEnv> =>
  T.flatMap((row: TopicRow | null) =>
    row === null ? T.fail(NotFound({ message: `No such topic: ${slug}.` })) : T.succeed(row),
  )(topicRow(slug))

const requireNotGeneral = (slug: string): T.Task<void, Conflict> =>
  slug === GENERAL_TOPIC
    ? T.fail(Conflict({ message: 'The general topic cannot be renamed, merged away or removed.' }))
    : T.succeed(undefined)

const enter = (conversationId: ConversationId, memberId: MemberId): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    yield* run(
      insertIgnoringConflict(yield* dialect, 'participants', {
        conversation_id: conversationId,
        member_id: memberId,
      }),
    )
  })

const openRoom = (
  topic: { readonly slug: string; readonly description: string },
  createdBy: MemberId | null,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const now = env.clock.now()
    const conversationId = ConversationId.of(env.random.identifier())
    yield* run(
      insertInto('conversations', {
        id: conversationId,
        kind: 'topic',
        title: topic.slug,
        created_at: now,
        last_activity_at: now,
        pair_key: null,
      }),
    )
    yield* run(
      insertInto('topics', {
        slug: topic.slug,
        description: topic.description,
        conversation_id: conversationId,
        created_by: createdBy,
        created_at: now,
      }),
    )
  })

const describe = (viewerId: MemberId, row: TopicRow): T.Task<Topic, never, AppEnv> =>
  T.gen(function* () {
    const helpers = yield* helpersOf(row.conversation_id)
    return {
      slug: row.slug,
      description: row.description,
      conversationId: row.conversation_id,
      helperCount: helpers.length,
      helping: helpers.includes(viewerId),
      createdAt: Number(row.created_at),
    }
  })
