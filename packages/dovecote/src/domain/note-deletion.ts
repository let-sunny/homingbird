import { Task as T } from '@homingbird/kernel'
import type { NoteId } from '@homingbird/protocol'
import { type HasSql, run } from '../sql/database.ts'
import { list, raw, sql } from '../sql/query.ts'

/** Deletes notes for good, with every row about one of them; a reply keeps its text and loses its parent. */
export const deleteNotes = (ids: ReadonlyArray<NoteId>): T.Task<number, never, HasSql> =>
  T.gen(function* () {
    if (ids.length === 0) return 0
    for (const table of ROWS_ABOUT_A_NOTE)
      yield* run(sql`DELETE FROM ${raw(table)} WHERE note_id IN ${list(ids)}`)
    return yield* run(sql`DELETE FROM notes WHERE id IN ${list(ids)}`)
  })

/** Well under every database's limit on parameters. */
export const NOTE_DELETION_BATCH = 500

const ROWS_ABOUT_A_NOTE = [
  'receipts',
  'pickups',
  'releases',
  'notices',
  'principle_applications',
  'principle_offers',
  'draft_request_answers',
  'history_answers',
  'slack_arrivals',
  'slack_outbox',
] as const
