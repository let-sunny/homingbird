import { type ReadableSignal, slice } from '@homingbird/ui'
import { type ListWait, pageWaitModels } from '../models/start.ts'
import type { Load, Resource } from '../resource.ts'
import type { AppState } from '../state.ts'
import { strings } from '../strings.ts'

/**
 * What a page draws from a resource that is nothing until it is read: its value, which changes only when the
 * data does, so that drawing it again never costs what the person typed, and what stands in its place until
 * then. Null read is an answer: no wait once it was read.
 */
export const pageData = <A>(
  state: Pick<AppState, 'workspace'>,
  held: Resource<A>,
): { readonly shown: ReadableSignal<A>; readonly wait: PageWait } => ({
  shown: slice([held], () => held.get()),
  wait: pageWaits(state, [held.load])[0]!,
})

/** What stands in place of each part of a page that is read in parts; the first one tells of them all. */
export const pageWaits = (
  state: Pick<AppState, 'workspace'>,
  loads: ReadonlyArray<ReadableSignal<Load>>,
): ReadonlyArray<PageWait> =>
  loads.map((_, index) =>
    slice([...loads, state.workspace], () => {
      const waits = pageWaitModels(
        loads.map((load) => load.get()),
        state.workspace.get(),
        strings.loading,
      )
      return waits[index]!
    }),
  )

export type PageWait = ReadableSignal<ListWait | null>
