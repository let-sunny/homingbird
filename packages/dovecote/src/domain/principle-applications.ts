import { Task as T } from '@homingbird/kernel'
import {
  type MemberId,
  NotFound,
  type NoteId,
  type Principle,
  appliedTitlesIn,
  isSameTitle,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, list, sql } from '../sql/query.ts'
import { ownPrinciple, principlesOf, withFigures } from './principle-rows.ts'
import { featureIsOn } from './settings.ts'

/**
 * Links a draft to the principles its basis says it applied, by title. A revised basis replaces the
 * draft's earlier claims; a claim it keeps keeps its "wrong here" mark.
 */
export const recordApplications = (
  memberId: MemberId,
  noteId: NoteId,
  basis: string | null,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (!(yield* featureIsOn('teaching'))) return
    const titles = appliedTitlesIn(basis)
    const applied = (yield* principlesOf(memberId)).filter(
      (principle) => principle.enabled && titles.some((title) => isSameTitle(title, principle.topic)),
    )
    yield* run(
      applied.length === 0
        ? sql`DELETE FROM principle_applications WHERE note_id = ${noteId} AND member_id = ${memberId}`
        : sql`DELETE FROM principle_applications WHERE note_id = ${noteId} AND member_id = ${memberId}
            AND principle_id NOT IN ${list(applied.map((principle) => principle.id))}`,
    )
    const now = env.clock.now()
    for (const principle of applied) {
      yield* run(
        insertIgnoringConflict(yield* dialect, 'principle_applications', {
          principle_id: principle.id,
          note_id: noteId,
          member_id: memberId,
          created_at: now,
          missed_at: null,
        }),
      )
      yield* run(sql`UPDATE principles SET last_applied_at = ${now} WHERE id = ${principle.id}`)
    }
  })

/** "This principle was wrong here": a miss against a principle the draft said it applied. */
export const recordMiss = (
  memberId: MemberId,
  id: string,
  noteId: NoteId,
): T.Task<Principle, NotFound, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    yield* ownPrinciple(memberId, id)
    const changed = yield* run(sql`UPDATE principle_applications SET missed_at = ${env.clock.now()}
      WHERE principle_id = ${id} AND note_id = ${noteId} AND member_id = ${memberId} AND missed_at IS NULL`)
    if (changed === 0) {
      const applied = yield* first(
        sql`SELECT note_id FROM principle_applications WHERE principle_id = ${id} AND note_id = ${noteId}`,
      )
      if (applied === null)
        return yield* T.fail(NotFound({ message: 'That draft did not say it applied this principle.' }))
    }
    return yield* withFigures(yield* ownPrinciple(memberId, id))
  })
