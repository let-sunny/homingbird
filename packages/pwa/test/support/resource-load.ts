import type { ApiError } from '@homingbird/protocol'
import type { Signal } from '@homingbird/ui'
import type { ListWait } from '../../src/models/start.ts'
import type { Load, Resource } from '../../src/resource.ts'
import type { AppState, Workspace } from '../../src/state.ts'
import { strings } from '../../src/strings.ts'
import { ACTIVITY, WORKSPACE } from '../../src/tasks/resources.ts'

/** Says how a resource's load is going, for a view or a model whose test asks nothing of a server. */
export const setLoad = (resource: Resource<never> | Resource<any>, load: Partial<Load>): void =>
  (resource.load as Signal<Load>).set({ loaded: false, step: 'idle', error: null, ...load })

/** Every list of the activity came from the server. */
export const setActivityLoaded = (state: AppState): void => {
  for (const key of ACTIVITY) setLoad(state[key], { loaded: true })
}

/** Says how loading the workspace is going, all of its lists alike. */
export const setWorkspace = (state: AppState, workspace: Workspace, error: ApiError | null = null): void => {
  for (const key of WORKSPACE)
    setLoad(state[key], workspace === 'loaded' ? { loaded: true } : { step: workspace, error })
}

/** The rooms came, and the people who name them. */
export const setRoomsDrawn = (state: AppState): void => {
  for (const key of ['conversations', 'directory'] as const) setLoad(state[key], { loaded: true })
}

/** What stands in place of page data that is being asked for as usual. */
export const CHECKING: ListWait = { kind: 'checking', text: strings.loading }
