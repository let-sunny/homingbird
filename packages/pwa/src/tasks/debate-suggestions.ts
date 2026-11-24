import { Task as T } from '@homingbird/kernel'
import type { AsRead, SuggestionAcceptance, SuggestionId } from '@homingbird/protocol'
import { withoutSuggestion } from '../activity.ts'
import { type Action, withApp } from '../app.ts'
import { invalidate } from './resources.ts'

/** The person's click to open the short flock, with what they changed; the suggestion is then gone. */
export const acceptSuggestion = (id: SuggestionId, change: SuggestionAcceptance): Action<AsRead.Debate> =>
  withApp(({ api, state }) =>
    T.tap((_: AsRead.Debate) =>
      T.flatMap(() => invalidate('debates'))(T.sync(() => state.suggestions.update(withoutSuggestion(id)))),
    )(api['debateSuggestions.accept']({ params: { id }, body: change })),
  )

/** "Just answer": the agent is not told, and the suggestion leaves the list. */
export const dismissSuggestion = (id: SuggestionId): Action =>
  withApp(({ api, state }) =>
    T.map(() => state.suggestions.update(withoutSuggestion(id)))(
      api['debateSuggestions.dismiss']({ params: { id } }),
    ),
  )
