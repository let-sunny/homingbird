import { type ReadableSignal, slice } from '@homingbird/ui'
import { type ListWait, pageWaitModel } from '../models/start.ts'
import type { Resource } from '../resource.ts'
import type { AppState } from '../state.ts'
import { strings } from '../strings.ts'

/**
 * What a page draws from a resource that is nothing until it is read: its value, which changes only when the
 * data does, so that drawing it again never costs what the person typed, and what stands in its place until then.
 */
export const pageData = <A>(
  state: Pick<AppState, 'workspace'>,
  held: Resource<A>,
): { readonly shown: ReadableSignal<A>; readonly wait: ReadableSignal<ListWait> } => ({
  shown: slice([held], () => held.get()),
  wait: slice([held.load, state.workspace], () => waitOf(state, held)),
})

/** The same for what the server may answer with nothing for, where null read is an answer: no wait once it was read. */
export const readPageData = <A>(
  state: Pick<AppState, 'workspace'>,
  held: Resource<A>,
): { readonly shown: ReadableSignal<A>; readonly wait: ReadableSignal<ListWait | null> } => ({
  shown: slice([held], () => held.get()),
  wait: slice([held.load, state.workspace], () => (held.load.get().loaded ? null : waitOf(state, held))),
})

const waitOf = (state: Pick<AppState, 'workspace'>, held: Pick<Resource<unknown>, 'load'>): ListWait =>
  pageWaitModel(held.load.get(), state.workspace.get(), strings.loading)
