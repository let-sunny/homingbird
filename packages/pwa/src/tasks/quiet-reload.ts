import { Task as T } from '@homingbird/kernel'
import type { Action } from '../app.ts'

/**
 * Reads again what a change the server already accepted has made stale. The change worked, so a failure
 * of this reload is not its failure and nobody is told of it: the next event or load repairs the page.
 * Only a refusal of the session passes on, since it ends the session whatever asked.
 */
export const reloadQuietly = (reload: Action<unknown>): Action =>
  T.gen(function* () {
    const outcome = yield* T.result(reload)
    if (outcome._tag === 'Err' && outcome.error._tag === 'Unauthorized') yield* T.fail(outcome.error)
  })
