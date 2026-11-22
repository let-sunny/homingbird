import { Task as T } from '@homingbird/kernel'
import type { NoteId } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { type RequestEnv, transact } from '../events/events.ts'
import { all } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { recordAudit } from './audit.ts'
import { NOTE_DELETION_BATCH, deleteNotes } from './note-deletion.ts'

/**
 * Deletes sent notes sent, and discarded notes discarded, more than `HB_NOTE_RETENTION_DAYS` ago, a batch
 * to a transaction, each batch audited with it. Drafts wait for their person and are never expired.
 */
export const purgeExpiredNotes: T.Task<number, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  const days = env.config.noteRetentionDays
  if (days === null) return 0
  return yield* purgeFrom(env.clock.now() - days * DAY_MS, days, 0)
})

const purgeFrom = (cutoff: number, days: number, removedBefore: number): T.Task<number, never, AppEnv> =>
  T.gen(function* () {
    const removed = yield* transact(purgeBatch(cutoff, days))
    return removed < NOTE_DELETION_BATCH
      ? removedBefore + removed
      : yield* purgeFrom(cutoff, days, removedBefore + removed)
  })

const purgeBatch = (cutoff: number, days: number): T.Task<number, never, RequestEnv> =>
  T.gen(function* () {
    const sent = yield* all<{ id: NoteId }>(
      sql`SELECT id FROM notes WHERE status = 'sent' AND sent_at < ${cutoff} LIMIT ${NOTE_DELETION_BATCH}`,
    )
    const discarded =
      sent.length < NOTE_DELETION_BATCH
        ? yield* all<{ id: NoteId }>(
            sql`SELECT id FROM notes WHERE status = 'discarded' AND COALESCE(decided_at, updated_at) < ${cutoff}
                LIMIT ${NOTE_DELETION_BATCH - sent.length}`,
          )
        : []
    const removed = yield* deleteNotes([...sent, ...discarded].map((row) => row.id))
    if (removed > 0) yield* recordAudit('note.retention_purged', { detail: { removed, days } })
    return removed
  })

const DAY_MS = 24 * 60 * 60_000
