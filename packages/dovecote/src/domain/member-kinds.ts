import { Task as T } from '@homingbird/kernel'
import { type MemberId, type MemberKind, NotFound } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'

/** Refuses the id of a channel's agent where only a person may be named, as though it were no member. */
export const requireNotAgent = (id: MemberId): T.Task<void, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* first<{ kind: MemberKind | null }>(sql`SELECT kind FROM members WHERE id = ${id}`)
    if (row !== null && row.kind !== 'person') return yield* T.fail(NotFound({ message: 'No such member.' }))
  })
