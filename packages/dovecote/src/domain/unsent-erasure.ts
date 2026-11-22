import { Task as T } from '@homingbird/kernel'
import type { MemberId, NoteId } from '@homingbird/protocol'
import type { RequestEnv } from '../events/events.ts'
import { type HasSql, all, run } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { recordAudit } from './audit.ts'
import { NOTE_DELETION_BATCH, deleteNotes } from './note-deletion.ts'

/** Deletes all a person never sent: drafts, discarded notes, draft requests and draft events; audited. */
export const eraseUnsentNotesOf = (memberId: MemberId): T.Task<UnsentErased, never, RequestEnv> =>
  T.gen(function* () {
    const unsent = yield* unsentNotesOf(memberId)
    for (const batch of batches(unsent.map((note) => note.id))) yield* deleteNotes(batch)
    yield* run(sql`UPDATE receipts SET drafting_at = NULL WHERE member_id = ${memberId}`)
    yield* run(
      sql`DELETE FROM draft_request_answers WHERE request_id IN (SELECT id FROM draft_requests WHERE member_id = ${memberId})`,
    )
    const draftRequests = yield* run(sql`DELETE FROM draft_requests WHERE member_id = ${memberId}`)
    yield* run(sql`DELETE FROM events WHERE member_id = ${memberId} AND body LIKE ${DRAFT_EVENT}`)
    const erased = countsOf(unsent, draftRequests)
    yield* recordAudit('note.unsent_erased', { targetId: memberId, detail: erased })
    return erased
  })

/** What the erasure would delete, counted without deleting anything. */
export const countUnsentOf = (memberId: MemberId): T.Task<UnsentErased, never, HasSql> =>
  T.gen(function* () {
    const unsent = yield* unsentNotesOf(memberId)
    const requests = yield* all<{ n: number | string }>(
      sql`SELECT COUNT(*) AS n FROM draft_requests WHERE member_id = ${memberId}`,
    )
    return countsOf(
      unsent,
      requests.reduce((sum, row) => sum + Number(row.n), 0),
    )
  })

export interface UnsentErased {
  readonly drafts: number
  readonly discarded: number
  readonly draftRequests: number
}

const unsentNotesOf = (
  memberId: MemberId,
): T.Task<ReadonlyArray<{ readonly id: NoteId; readonly status: string }>, never, HasSql> =>
  all(sql`SELECT id, status FROM notes WHERE author_id = ${memberId} AND status <> 'sent'`)

const countsOf = (
  unsent: ReadonlyArray<{ readonly status: string }>,
  draftRequests: number,
): UnsentErased => ({
  drafts: unsent.filter((note) => note.status === 'draft').length,
  discarded: unsent.filter((note) => note.status !== 'draft').length,
  draftRequests,
})

const batches = <A>(items: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(items.length / NOTE_DELETION_BATCH) }, (_, index) =>
    items.slice(index * NOTE_DELETION_BATCH, (index + 1) * NOTE_DELETION_BATCH),
  )

const DRAFT_EVENT = '{"type":"draft.saved",%'
