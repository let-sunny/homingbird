import { Task as T } from '@homingbird/kernel'
import { Conflict, type MemberId, type NotFound, type Topic } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, dialect, run } from '../sql/database.ts'
import { insertIgnoringConflict, sql } from '../sql/query.ts'
import { abandonDraft } from './abandoned-drafts.ts'
import type { NoteRow } from './note-rows.ts'
import { type Viewer, describeTopic, existingTopic, topicRow } from './topic-rows.ts'

export const reviseTopic = (
  viewer: Viewer,
  slug: string,
  changes: { readonly slug?: string; readonly description?: string },
): T.Task<Topic, NotFound | Conflict, AppEnv> =>
  T.gen(function* () {
    const row = yield* existingTopic(slug)
    const renamed = changes.slug ?? slug
    if (renamed !== slug && (yield* topicRow(renamed)) !== null)
      return yield* T.fail(Conflict({ message: 'That name is not available.' }))
    yield* run(
      sql`UPDATE topics SET slug = ${renamed}, description = ${changes.description ?? row.description} WHERE slug = ${slug}`,
    )
    yield* run(sql`UPDATE conversations SET title = ${renamed} WHERE id = ${row.conversation_id}`)
    return yield* describeTopic(viewer, yield* existingTopic(renamed))
  })

export const removeTopic = (slug: string): T.Task<void, NotFound, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const row = yield* existingTopic(slug)
    const drafts = yield* all<NoteRow>(
      sql`SELECT * FROM notes WHERE conversation_id = ${row.conversation_id} AND status = 'draft' ORDER BY id`,
    )
    for (const draft of drafts) yield* abandonDraft(draft)
    yield* run(sql`DELETE FROM topic_helpers WHERE conversation_id = ${row.conversation_id}`)
    yield* run(sql`DELETE FROM topic_managers WHERE conversation_id = ${row.conversation_id}`)
    yield* run(sql`DELETE FROM topics WHERE slug = ${slug}`)
    yield* run(
      sql`UPDATE conversations SET kind = 'group', archived_at = ${env.clock.now()} WHERE id = ${row.conversation_id}`,
    )
  })

export const mergeTopic = (
  viewer: Viewer,
  slug: string,
  intoSlug: string,
): T.Task<Topic, NotFound | Conflict, RequestEnv> =>
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
    return yield* describeTopic(viewer, into)
  })
