import { Task as T } from '@homingbird/kernel'
import type { AsRead, SuggestionAcceptance, SuggestionId } from '@homingbird/protocol'
import { type Action, withApp } from '../app.ts'
import { featureOn } from '../features.ts'
import { loadDebates } from './debates.ts'

/** The suggestions waiting for the person; nothing is asked while the feature is off. */
export const loadSuggestions: Action = withApp(({ api, state }) =>
  featureOn('debateSuggestions', state.serverInfo.get())
    ? T.map((listed: { suggestions: ReadonlyArray<AsRead.DebateSuggestion> }) =>
        state.suggestions.set(listed.suggestions),
      )(api['debateSuggestions.list']({}))
    : T.unit,
)

/** The person's click to open the short room, with what they changed; the suggestion is then gone. */
export const acceptSuggestion = (id: SuggestionId, change: SuggestionAcceptance): Action<AsRead.Debate> =>
  withApp(({ api, state }) =>
    T.tap((_: AsRead.Debate) =>
      T.flatMap(() => loadDebates)(
        T.sync(() => state.suggestions.update((all) => all.filter((one) => one.id !== id))),
      ),
    )(api['debateSuggestions.accept']({ params: { id }, body: change })),
  )

/** "Just answer": the agent is not told, and the suggestion leaves the list. */
export const dismissSuggestion = (id: SuggestionId): Action =>
  withApp(({ api, state }) =>
    T.map(() => state.suggestions.update((all) => all.filter((one) => one.id !== id)))(
      api['debateSuggestions.dismiss']({ params: { id } }),
    ),
  )
