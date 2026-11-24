import type { Signal } from '@homingbird/ui'
import type { Load, Resource } from '../../src/resource.ts'
import type { AppState } from '../../src/state.ts'

/** Says how a resource's load is going, for a view or a model whose test asks nothing of a server. */
export const setLoad = (resource: Resource<never> | Resource<any>, load: Partial<Load>): void =>
  (resource.load as Signal<Load>).set({ loaded: false, step: 'idle', error: null, ...load })

/** Every list of the activity came from the server. */
export const setActivityLoaded = (state: AppState): void => {
  for (const key of ['awaitingReply', 'reviews', 'suggestions', 'debates'] as const)
    setLoad(state[key], { loaded: true })
}
