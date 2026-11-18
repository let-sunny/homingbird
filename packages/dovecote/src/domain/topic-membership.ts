import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  Forbidden,
  GENERAL_TOPIC,
  type MemberId,
  NotFound,
  type Topic,
  type TopicMember,
  type TopicVisibility,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { first, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import {
  type TopicRow,
  type Viewer,
  depart,
  describeTopic,
  enter,
  helpersOf,
  isMemberOf,
  makeManager,
  managersOf,
  membersOf,
  requireManagerRemains,
  tellAboutTopic,
  visibilityOf,
  visibleTopic,
} from './topic-rows.ts'

export const topicMembers = (viewer: Viewer, slug: string): T.Task<TopicMember[], TopicFailure, AppEnv> =>
  T.gen(function* () {
    const row = yield* visibleTopic(viewer, slug)
    if (!(yield* isMemberOf(row.conversation_id, viewer.id)) && viewer.role !== 'admin')
      return yield* T.fail(Forbidden({ message: 'Join the topic to see who is in it.' }))
    const helpers = yield* helpersOf(row.conversation_id)
    const managers = yield* managersOf(row.conversation_id)
    return (yield* membersOf(row.conversation_id)).map((memberId) => ({
      memberId,
      answering: helpers.includes(memberId),
      manager: managers.includes(memberId),
    }))
  })

export const addTopicMember = (
  viewer: Viewer,
  slug: string,
  memberId: MemberId,
): T.Task<Topic, TopicFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedPrivateTopic(viewer, slug, 'People join an open topic by themselves.')
    yield* requireActiveMember(memberId)
    yield* enter(row.conversation_id, memberId)
    yield* tellAboutTopic(row, [memberId, ...(yield* managersOf(row.conversation_id))])
    return yield* describeTopic(viewer, row)
  })

export const removeTopicMember = (
  viewer: Viewer,
  slug: string,
  memberId: MemberId,
): T.Task<Topic, TopicFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedPrivateTopic(viewer, slug, 'People leave an open topic by themselves.')
    if (!(yield* isMemberOf(row.conversation_id, memberId))) return yield* describeTopic(viewer, row)
    yield* requireManagerRemains(row, { leaving: memberId })
    yield* depart(row, memberId)
    yield* tellAboutTopic(row, yield* managersOf(row.conversation_id))
    return yield* describeTopic(viewer, row)
  })

export const grantManager = (
  viewer: Viewer,
  slug: string,
  memberId: MemberId,
): T.Task<Topic, TopicFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedTopic(viewer, slug)
    if (!(yield* isMemberOf(row.conversation_id, memberId)))
      return yield* T.fail(Conflict({ message: 'Only a member of the topic can become its manager.' }))
    yield* makeManager(row.conversation_id, memberId)
    yield* tellAboutTopic(row, yield* managersOf(row.conversation_id))
    return yield* describeTopic(viewer, row)
  })

export const revokeManager = (
  viewer: Viewer,
  slug: string,
  memberId: MemberId,
): T.Task<Topic, TopicFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedTopic(viewer, slug)
    const managers = yield* managersOf(row.conversation_id)
    if (!managers.includes(memberId)) return yield* describeTopic(viewer, row)
    yield* requireManagerRemains(row, { steppingDown: memberId })
    yield* run(
      sql`DELETE FROM topic_managers WHERE conversation_id = ${row.conversation_id} AND member_id = ${memberId}`,
    )
    yield* tellAboutTopic(row, managers)
    return yield* describeTopic(viewer, row)
  })

export const setVisibility = (
  viewer: Viewer,
  slug: string,
  visibility: TopicVisibility,
): T.Task<Topic, TopicFailure, RequestEnv> =>
  T.gen(function* () {
    const row = yield* managedTopic(viewer, slug)
    if (visibilityOf(row) === visibility) return yield* describeTopic(viewer, row)
    if (row.slug === GENERAL_TOPIC)
      return yield* T.fail(Conflict({ message: 'The general topic stays open to everyone.' }))
    if (visibility === 'private' && (yield* managersOf(row.conversation_id)).length === 0)
      return yield* T.fail(
        Conflict({ message: 'Make a member of this topic its manager before making it private.' }),
      )
    yield* run(sql`UPDATE topics SET visibility = ${visibility} WHERE slug = ${row.slug}`)
    const changed: TopicRow = { ...row, visibility }
    yield* tellAboutTopic(changed, yield* membersOf(row.conversation_id))
    return yield* describeTopic(viewer, changed)
  })

export type TopicFailure = NotFound | Forbidden | Conflict

const managedTopic = (viewer: Viewer, slug: string): T.Task<TopicRow, TopicFailure, AppEnv> =>
  T.gen(function* () {
    const row = yield* visibleTopic(viewer, slug)
    if (viewer.role === 'admin') return row
    if (!(yield* managersOf(row.conversation_id)).includes(viewer.id))
      return yield* T.fail(Forbidden({ message: 'Only a manager of this topic can do this.' }))
    return row
  })

const managedPrivateTopic = (
  viewer: Viewer,
  slug: string,
  whenOpen: string,
): T.Task<TopicRow, TopicFailure, AppEnv> =>
  T.gen(function* () {
    const row = yield* managedTopic(viewer, slug)
    if (visibilityOf(row) === 'open') return yield* T.fail(Conflict({ message: whenOpen }))
    return row
  })

const requireActiveMember = (memberId: MemberId): T.Task<void, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* first(sql`SELECT id FROM members WHERE id = ${memberId} AND status = 'active'`)
    if (row === null) return yield* T.fail(NotFound({ message: 'No such member.' }))
  })
