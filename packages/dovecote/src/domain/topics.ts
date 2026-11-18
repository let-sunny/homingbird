import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  ConversationId,
  Forbidden,
  type MemberId,
  type NotFound,
  type Topic,
  type TopicVisibility,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, run } from '../sql/database.ts'
import { containsIgnoringCase, insertInto, list, sql } from '../sql/query.ts'
import {
  type TopicRow,
  type Viewer,
  depart,
  describeTopic,
  enter,
  existingTopic,
  isMemberOf,
  makeManager,
  membersOf,
  noSuchTopic,
  requireManagerRemains,
  startAnswering,
  tellAboutTopic,
  topicOfRoom,
  topicRow,
  visibilityOf,
  visibleTopic,
} from './topic-rows.ts'

export const listTopics = (
  viewer: Viewer,
  page: { readonly search: string | undefined; readonly limit: number; readonly offset: number },
): T.Task<{ topics: Topic[]; hasMore: boolean; cursor: string | null }, never, AppEnv> =>
  T.gen(function* () {
    const { search, limit, offset } = page
    const matching = search
      ? sql`AND (${containsIgnoringCase('t.slug', search)} OR ${containsIgnoringCase('t.description', search)})`
      : sql``
    const rows = yield* all<TopicRow>(sql`
      SELECT t.* FROM topics t WHERE ${visibleTo(viewer)} ${matching}
      ORDER BY
        CASE WHEN EXISTS (SELECT 1 FROM participants j WHERE j.conversation_id = t.conversation_id AND j.member_id = ${viewer.id}) THEN 0 ELSE 1 END,
        (SELECT COUNT(*) FROM participants m WHERE m.conversation_id = t.conversation_id) DESC,
        t.slug
      LIMIT ${limit + 1} OFFSET ${offset}`)
    const hasMore = rows.length > limit
    return {
      topics: yield* T.forEach(rows.slice(0, limit), (row) => describeTopic(viewer, row)),
      hasMore,
      cursor: hasMore ? String(offset + limit) : null,
    }
  })

export const topicNamed = (viewer: Viewer, slug: string): T.Task<Topic, NotFound, AppEnv> =>
  T.flatMap((row: TopicRow) => describeTopic(viewer, row))(visibleTopic(viewer, slug))

export const createTopic = (
  creator: Viewer,
  topic: { readonly slug: string; readonly description: string; readonly visibility?: TopicVisibility },
): T.Task<Topic, Conflict, RequestEnv> =>
  T.gen(function* () {
    if ((yield* topicRow(topic.slug)) !== null) return yield* T.fail(nameNotAvailable)
    const row = yield* openRoom({ ...topic, visibility: topic.visibility ?? 'open' }, creator.id)
    yield* enter(row.conversation_id, creator.id)
    yield* startAnswering(row.conversation_id, creator.id)
    yield* makeManager(row.conversation_id, creator.id)
    yield* tellAboutTopic(row, [creator.id])
    return yield* describeTopic(creator, row)
  })

export const joinTopic = (
  viewer: Viewer,
  slug: string,
  answering: boolean,
): T.Task<Topic, NotFound | Forbidden, RequestEnv> =>
  T.gen(function* () {
    const row = yield* visibleTopic(viewer, slug)
    const isMember = yield* isMemberOf(row.conversation_id, viewer.id)
    if (!isMember && visibilityOf(row) === 'private')
      return yield* T.fail(Forbidden({ message: 'Only a manager of this private topic can add members.' }))
    yield* enter(row.conversation_id, viewer.id)
    if (answering) yield* startAnswering(row.conversation_id, viewer.id)
    yield* tellAboutTopic(row, [viewer.id])
    return yield* describeTopic(viewer, row)
  })

export const leaveTopic = (viewer: Viewer, slug: string): T.Task<Topic, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const row = yield* visibleTopic(viewer, slug)
    if (yield* isMemberOf(row.conversation_id, viewer.id)) {
      yield* requireManagerRemains(row, { leaving: viewer.id })
      yield* depart(row, viewer.id)
    }
    return yield* describeTopic(viewer, row)
  })

export const setAnswering = (
  viewer: Viewer,
  slug: string,
  answering: boolean,
): T.Task<Topic, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const row = yield* visibleTopic(viewer, slug)
    if (!(yield* isMemberOf(row.conversation_id, viewer.id)))
      return yield* T.fail(Conflict({ message: 'Join the topic before answering questions in it.' }))
    if (answering) yield* startAnswering(row.conversation_id, viewer.id)
    else
      yield* run(
        sql`DELETE FROM topic_helpers WHERE conversation_id = ${row.conversation_id} AND member_id = ${viewer.id}`,
      )
    yield* tellAboutTopic(row, [viewer.id])
    return yield* describeTopic(viewer, row)
  })

export const topicRoomFor = (askerId: MemberId, slug: string): T.Task<ConversationId, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* existingTopic(slug)
    const isMember = yield* isMemberOf(row.conversation_id, askerId)
    if (isMember) return row.conversation_id
    if (visibilityOf(row) === 'private') return yield* T.fail(noSuchTopic(slug))
    yield* enter(row.conversation_id, askerId)
    return row.conversation_id
  })

export const roomForMovedQuestion = (
  moverId: MemberId,
  askerId: MemberId,
  from: ConversationId,
  slug: string,
): T.Task<ConversationId, NotFound | Conflict, AppEnv> =>
  T.gen(function* () {
    const destination = yield* existingTopic(slug)
    const origin = yield* topicOfRoom(from)
    const isPrivate = visibilityOf(destination) === 'private'
    if (isPrivate && !(yield* isMemberOf(destination.conversation_id, moverId)))
      return yield* T.fail(noSuchTopic(slug))
    if (origin !== null && visibilityOf(origin) === 'private' && destination.conversation_id !== from) {
      const sameMembers =
        isPrivate &&
        sameSet(yield* membersOf(origin.conversation_id), yield* membersOf(destination.conversation_id))
      if (!sameMembers)
        return yield* T.fail(
          Conflict({
            message:
              'A question in a private topic can move only to another private topic with the same members.',
          }),
        )
    }
    if (isPrivate && !(yield* isMemberOf(destination.conversation_id, askerId)))
      return yield* T.fail(
        Conflict({ message: 'The person who asked is not a member of that private topic.' }),
      )
    return yield* topicRoomFor(askerId, slug)
  })

export const topicsHelpedBy = (
  viewer: Viewer,
  memberIds: ReadonlyArray<MemberId>,
): T.Task<Map<MemberId, string[]>, never, AppEnv> =>
  T.gen(function* () {
    const helped = new Map<MemberId, string[]>()
    if (memberIds.length === 0) return helped
    const rows = yield* all<{ member_id: MemberId; slug: string }>(sql`
      SELECT h.member_id, t.slug FROM topic_helpers h JOIN topics t ON t.conversation_id = h.conversation_id
      WHERE h.member_id IN ${list([...new Set(memberIds)])} AND ${sharedWith(viewer.id)} ORDER BY t.slug`)
    for (const row of rows) helped.set(row.member_id, [...(helped.get(row.member_id) ?? []), row.slug])
    return helped
  })

export const helpersOfTopicSeenBy = (viewerId: MemberId, slug: string): ReturnType<typeof sql> =>
  sql`SELECT h.member_id FROM topic_helpers h JOIN topics t ON t.conversation_id = h.conversation_id WHERE t.slug = ${slug} AND ${sharedWith(viewerId)}`

export const seedTopics: T.Task<void, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  for (const topic of env.config.topics) {
    if ((yield* topicRow(topic.slug)) !== null) continue
    yield* openRoom({ ...topic, visibility: 'open' }, null)
  }
})

const nameNotAvailable = Conflict({ message: 'That name is not available.' })

const visibleTo = (viewer: Viewer): ReturnType<typeof sql> =>
  viewer.role === 'admin' ? sql`1 = 1` : sharedWith(viewer.id)

const sharedWith = (
  viewerId: MemberId,
): ReturnType<typeof sql> => sql`(t.visibility IS NULL OR t.visibility <> 'private'
  OR EXISTS (SELECT 1 FROM participants v WHERE v.conversation_id = t.conversation_id AND v.member_id = ${viewerId}))`

const sameSet = (a: ReadonlyArray<MemberId>, b: ReadonlyArray<MemberId>): boolean =>
  a.length === b.length && a.every((id) => b.includes(id))

const openRoom = (
  topic: { readonly slug: string; readonly description: string; readonly visibility: TopicVisibility },
  createdBy: MemberId | null,
): T.Task<TopicRow, never, AppEnv> =>
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
    const row: TopicRow = {
      slug: topic.slug,
      description: topic.description,
      conversation_id: conversationId,
      visibility: topic.visibility,
      created_at: now,
    }
    yield* run(insertInto('topics', { ...row, created_by: createdBy }))
    return row
  })
