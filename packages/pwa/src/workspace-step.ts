import type { ApiError } from '@homingbird/protocol'
import { isTransient, refusalText } from './refusals.ts'
import type { Load } from './resource.ts'
import type { Workspace } from './state.ts'

/** How loading the workspace is going, from its lists: the worst of those that were never read. */
export const workspaceStep = (loads: ReadonlyArray<Load>): Workspace => {
  const awaited = loads.filter((load) => !load.loaded).map((load) => load.step)
  if (awaited.length === 0) return 'loaded'
  return WORST_FIRST.find((step) => awaited.includes(step)) ?? 'loading'
}

/** What the server refused one of the lists with, for a reason waiting does not mend, or nothing. */
export const workspaceRefusalText = (loads: ReadonlyArray<Load>): string => {
  const refused = loads
    .filter((load) => !load.loaded && load.step === 'failed')
    .map((load) => load.error)
    .find((error): error is ApiError => error !== null && !isTransient(error))
  return refused === undefined ? '' : refusalText(refused)
}

const WORST_FIRST = ['failed', 'long', 'slow'] as const
