import { isSameData } from './same-data.ts'
import { type ReadableSignal, derived } from './signal.ts'

/**
 * The part of a broad state that a view draws from: it changes only when that part holds different
 * data, so a region that follows it does not redraw for the rest of the state.
 */
export const slice = <A>(
  sources: ReadonlyArray<ReadableSignal<unknown>>,
  compute: () => A,
): ReadableSignal<A> => derived(sources, compute, isSameData)
