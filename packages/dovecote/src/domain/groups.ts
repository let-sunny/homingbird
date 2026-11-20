import { Task as T } from '@homingbird/kernel'
import { type Group, type GroupId, NotFound } from '@homingbird/protocol'
import { type AppEnv, type Caller, isHuman, viewerOf } from '../environment.ts'
import { all, first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import type { Viewer } from './channel-rows.ts'
import { visibleTo } from './channels.ts'
import { type GroupRow, groupMembersOf, lockGroups, mayChangeGroup } from './group-rows.ts'

/** Every member sees every team; a channel's group only where they may see its channel (rule 6). */
export const listGroups = (viewer: GroupViewer): T.Task<{ groups: Group[] }, never, AppEnv> =>
  T.gen(function* () {
    const rows = yield* all<GroupRow>(
      sql`SELECT r.* FROM member_groups r WHERE ${shownTo(viewer)} ORDER BY r.created_at, r.id`,
    )
    return { groups: yield* T.forEach(rows, (row) => describeGroup(viewer, row)) }
  })

export const groupById = (viewer: GroupViewer, id: GroupId): T.Task<Group, NotFound, AppEnv> =>
  T.flatMap((row: GroupRow) => describeGroup(viewer, row))(shownGroup(viewer, id))

/** A group the viewer is shown, read under its row lock; any other is not found, before any rights. */
export const lockedGroup = (viewer: Viewer, id: GroupId): T.Task<GroupRow, NotFound, AppEnv> =>
  T.gen(function* () {
    yield* lockGroups([id])
    return yield* shownGroup(viewer, id)
  })

export const describeGroup = (viewer: GroupViewer, row: GroupRow): T.Task<Group, never, AppEnv> =>
  T.gen(function* () {
    const channels = yield* all<{ slug: string }>(
      sql`SELECT t.slug FROM channels t WHERE t.manager_group_id = ${row.id} AND ${visibleTo(viewer)} ORDER BY t.slug`,
    )
    return {
      id: row.id,
      kind: row.kind,
      name: row.name ?? null,
      memberIds: yield* groupMembersOf(row.id),
      channels: channels.map((channel) => channel.slug),
      mayAdd: viewer.person && (yield* mayChangeGroup(viewer, row, 'add')),
      mayRemove: viewer.person && (yield* mayChangeGroup(viewer, row, 'remove')),
      createdAt: Number(row.created_at),
    }
  })

/** A viewer of groups; only a person may change one, so an agent is told it may not. */
export interface GroupViewer extends Viewer {
  readonly person: boolean
}

export const groupViewerOf = (caller: Caller): GroupViewer => ({
  ...viewerOf(caller),
  person: isHuman(caller),
})

const shownGroup = (viewer: Viewer, id: GroupId): T.Task<GroupRow, NotFound, AppEnv> =>
  T.flatMap((row: GroupRow | null) =>
    row === null ? T.fail(NotFound({ message: 'No such group.' })) : T.succeed(row),
  )(first<GroupRow>(sql`SELECT r.* FROM member_groups r WHERE r.id = ${id} AND ${shownTo(viewer)}`))

const shownTo = (viewer: Viewer): ReturnType<typeof sql> =>
  sql`(r.kind = 'team' OR EXISTS (SELECT 1 FROM channels t WHERE t.manager_group_id = r.id AND ${visibleTo(viewer)}))`
