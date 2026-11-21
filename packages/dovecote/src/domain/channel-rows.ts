import { Task as T } from '@homingbird/kernel'
import {
  type Channel,
  type ChannelVisibility,
  Conflict,
  type ConversationId,
  type GroupId,
  type Member,
  type MemberId,
  NotFound,
} from '@homingbird/protocol'
import type { AppEnv, Caller } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, sql } from '../sql/query.ts'
import { abandonDraftsIn } from './abandoned-drafts.ts'
import { recordAudit } from './audit.ts'
import { featureIsOn } from './settings.ts'

export type Viewer = Pick<Member, 'id' | 'role'>

export interface ChannelRow {
  readonly slug: string
  readonly description: string
  readonly conversation_id: ConversationId
  readonly visibility: ChannelVisibility | null
  readonly created_at: number
  readonly manager_group_id: GroupId
}

export const visibleChannel = (viewer: Viewer, slug: string): T.Task<ChannelRow, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* channelRow(slug)
    if (row === null || !(yield* maySee(viewer, row))) return yield* T.fail(noSuchChannel(slug))
    return row
  })

export const describeChannel = (viewer: Viewer, row: ChannelRow): T.Task<Channel, never, AppEnv> =>
  T.gen(function* () {
    const members = yield* membersOf(row.conversation_id)
    const helpers = yield* helpersOf(row.conversation_id)
    const managers = yield* managersOf(row)
    const joined = members.includes(viewer.id)
    const agentsOn = yield* featureIsOn('channelAgents')
    const agent = agentsOn ? yield* channelAgentOf(row) : null
    const runsAgent = agentsOn && joined && managers.includes(viewer.id)
    const { hub } = yield* T.ask<AppEnv>()
    return {
      slug: row.slug,
      description: row.description,
      conversationId: row.conversation_id,
      visibility: visibilityOf(row),
      memberCount: members.length,
      helperCount: helpers.length,
      joined,
      answering: helpers.includes(viewer.id),
      managing:
        (joined && managers.includes(viewer.id)) || (viewer.role === 'admin' && visibilityOf(row) === 'open'),
      managedBy: row.manager_group_id,
      agent:
        agent === null
          ? null
          : {
              id: agent.id,
              name: agent.name,
              presence: hub.presenceOf(agent.id, runsAgent ? agent.id : viewer.id),
            },
      runsAgent,
      createdAt: Number(row.created_at),
    }
  })

/** A channel's agent: the one active member of that kind in its room, which only its managers put there. */
export const channelAgentOf = (
  row: Pick<ChannelRow, 'conversation_id'>,
): T.Task<{ readonly id: MemberId; readonly name: string } | null, never, AppEnv> =>
  first<{ id: MemberId; name: string }>(sql`
    SELECT m.id, m.name FROM participants p JOIN members m ON m.id = p.member_id
    WHERE p.conversation_id = ${row.conversation_id} AND m.kind = 'channel_agent' AND m.status = 'active'
    ORDER BY m.id LIMIT 1`)

/** The channel a room belongs to: the channel's own room, or a question asked privately of its agent. */
export const channelOfAgentRoom = (
  conversationId: ConversationId,
): T.Task<ChannelRow | null, never, AppEnv> =>
  T.gen(function* () {
    const room = yield* first<{ channel_id: ConversationId | null }>(
      sql`SELECT channel_id FROM conversations WHERE id = ${conversationId}`,
    )
    if (room === null) return null
    return yield* channelOfRoom(room.channel_id ?? conversationId)
  })

/**
 * Whether a room is visible without being in it: an open one to everyone, a private one to administrators
 * only. Channels and debate rooms share this rule; members of a private room see it through membership.
 */
export const isVisibleRoom = (visibility: ChannelVisibility, viewer: Pick<Viewer, 'role'>): boolean =>
  visibility === 'open' || viewer.role === 'admin'

export const visibilityOf = (row: ChannelRow): ChannelVisibility => row.visibility ?? 'open'

export const channelRow = (slug: string): T.Task<ChannelRow | null, never, AppEnv> =>
  first<ChannelRow>(sql`SELECT * FROM channels WHERE slug = ${slug}`)

export const channelOfRoom = (conversationId: ConversationId): T.Task<ChannelRow | null, never, AppEnv> =>
  first<ChannelRow>(sql`SELECT * FROM channels WHERE conversation_id = ${conversationId}`)

export const existingChannel = (slug: string): T.Task<ChannelRow, NotFound, AppEnv> =>
  T.flatMap((row: ChannelRow | null) => (row === null ? T.fail(noSuchChannel(slug)) : T.succeed(row)))(
    channelRow(slug),
  )

export const noSuchChannel = (slug: string): NotFound => NotFound({ message: `No such channel: ${slug}.` })

export const isMemberOf = (
  conversationId: ConversationId,
  memberId: MemberId,
): T.Task<boolean, never, AppEnv> =>
  T.map((row: unknown) => row !== null)(
    first(
      sql`SELECT 1 AS present FROM participants WHERE conversation_id = ${conversationId} AND member_id = ${memberId}`,
    ),
  )

/** The people in a room; its channel's agent is not one, so it never counts, moves or keeps a manager. */
export const membersOf = (conversationId: ConversationId): T.Task<MemberId[], never, AppEnv> =>
  idsOf(sql`
    SELECT p.member_id FROM participants p JOIN members m ON m.id = p.member_id
    WHERE p.conversation_id = ${conversationId} AND m.status = 'active' AND m.kind = 'person' ORDER BY p.member_id`)

/** The people who answer in a room. */
export const helpersOf = (conversationId: ConversationId): T.Task<MemberId[], never, AppEnv> =>
  idsOf(sql`
    SELECT h.member_id FROM channel_answerers h JOIN members m ON m.id = h.member_id
    WHERE h.conversation_id = ${conversationId} AND m.status = 'active' AND m.kind = 'person' ORDER BY h.member_id`)

/** Whom a question in a room is delivered to: its helpers and its channel's agent. */
export const answerersOf = (conversationId: ConversationId): T.Task<MemberId[], never, AppEnv> =>
  idsOf(sql`
    SELECT h.member_id FROM channel_answerers h JOIN members m ON m.id = h.member_id
    WHERE h.conversation_id = ${conversationId} AND m.status = 'active' ORDER BY h.member_id`)

/** The active people of the channel's group, every one of them in its room. */
export const managersOf = (
  row: Pick<ChannelRow, 'conversation_id' | 'manager_group_id'>,
): T.Task<MemberId[], never, AppEnv> =>
  idsOf(sql`
    SELECT g.member_id FROM group_members g JOIN members m ON m.id = g.member_id
    JOIN participants p ON p.conversation_id = ${row.conversation_id} AND p.member_id = g.member_id
    WHERE g.group_id = ${row.manager_group_id} AND m.status = 'active' AND m.kind = 'person' ORDER BY g.member_id`)

export const enter = (conversationId: ConversationId, memberId: MemberId): T.Task<void, never, AppEnv> =>
  addTo('participants', conversationId, memberId)

/**
 * Puts people into the room on someone's behalf, as when they join its managing group, recording each
 * one not in it yet as the route that adds a member does.
 */
export const admit = (
  caller: Caller,
  row: ChannelRow,
  memberIds: Iterable<MemberId>,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    for (const memberId of new Set(memberIds)) {
      if (yield* isMemberOf(row.conversation_id, memberId)) continue
      yield* enter(row.conversation_id, memberId)
      yield* recordAudit('channel.member_added', { caller, targetId: row.slug, detail: { memberId } })
    }
  })

export const startAnswering = (
  conversationId: ConversationId,
  memberId: MemberId,
): T.Task<void, never, AppEnv> => addTo('channel_answerers', conversationId, memberId)

export const depart = (row: ChannelRow, memberId: MemberId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const room = row.conversation_id
    yield* run(sql`DELETE FROM channel_answerers WHERE conversation_id = ${room} AND member_id = ${memberId}`)
    yield* run(sql`DELETE FROM participants WHERE conversation_id = ${room} AND member_id = ${memberId}`)
    yield* abandonDraftsIn(room, memberId)
    yield* emit([memberId], { type: 'channel.left', slug: row.slug, conversationId: room })
  })

export const requireManagerRemains = (
  row: ChannelRow,
  change: { readonly leaving: MemberId },
): T.Task<void, Conflict, AppEnv> =>
  T.gen(function* () {
    const managers = yield* managersOf(row)
    if (managers.length === 0) return
    const members = (yield* membersOf(row.conversation_id)).filter((id) => id !== change.leaving)
    const remaining = managers.filter((id) => id !== change.leaving)
    if (members.length > 0 && remaining.length === 0)
      return yield* T.fail(
        Conflict({ message: 'Make another member a manager first: a channel with members keeps a manager.' }),
      )
  })

/** A member of the managing group stays in the room while anyone else is in it: they manage it. */
export const requireOutsideManagingGroup = (
  row: ChannelRow,
  memberId: MemberId,
): T.Task<void, Conflict, AppEnv> =>
  T.gen(function* () {
    if (!(yield* managersOf(row)).includes(memberId)) return
    if ((yield* membersOf(row.conversation_id)).every((id) => id === memberId)) return
    return yield* T.fail(
      Conflict({
        message:
          'Members of the group that manages this channel stay in it: leave that group first, or take them out of it.',
      }),
    )
  })

export const tellAboutChannel = (
  row: ChannelRow,
  recipients: Iterable<MemberId>,
): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    for (const memberId of new Set(recipients)) {
      const viewer = yield* first<Viewer>(sql`SELECT id, role FROM members WHERE id = ${memberId}`)
      if (viewer === null) continue
      yield* emit([memberId], { type: 'channel.changed', channel: yield* describeChannel(viewer, row) })
    }
  })

const addTo = (
  table: 'participants' | 'channel_answerers',
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

const maySee = (viewer: Viewer, row: ChannelRow): T.Task<boolean, never, AppEnv> =>
  isVisibleRoom(visibilityOf(row), viewer) ? T.succeed(true) : isMemberOf(row.conversation_id, viewer.id)
