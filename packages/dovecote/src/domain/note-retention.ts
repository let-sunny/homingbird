import { Task as T } from '@homingbird/kernel'
import type { NoteId } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { type RequestEnv, transact } from '../events/events.ts'
import { all, first } from '../sql/database.ts'
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
  const removed = yield* purgeFrom(env.clock.now() - days * DAY_MS, days, 0)
  env.log.emit({ name: 'housekeeping.notes_purged', attributes: { removed, days } })
  return removed
})

/** What a retention of `days` would delete now, as `dovecote notes retention --dry-run` shows it; changes nothing. */
export const expiredNoteCounts = (days: number): T.Task<ExpiredNoteCounts, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const cutoff = env.clock.now() - days * DAY_MS
    const sent = yield* first<{ n: number | string; oldest: number | string | null }>(
      sql`SELECT COUNT(*) AS n, MIN(sent_at) AS oldest FROM notes WHERE status = 'sent' AND sent_at < ${cutoff}`,
    )
    const discarded = yield* first<{ n: number | string }>(
      sql`SELECT COUNT(*) AS n FROM notes WHERE status = 'discarded' AND COALESCE(decided_at, updated_at) < ${cutoff}`,
    )
    const notes = yield* first<{ n: number | string }>(sql`SELECT COUNT(*) AS n FROM notes`)
    return {
      cutoff,
      sent: Number(sent?.n ?? 0),
      discarded: Number(discarded?.n ?? 0),
      notes: Number(notes?.n ?? 0),
      oldestSentAt: sent?.oldest == null ? null : Number(sent.oldest),
    }
  })

export interface ExpiredNoteCounts {
  readonly cutoff: number
  readonly sent: number
  readonly discarded: number
  readonly notes: number
  readonly oldestSentAt: number | null
}

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
