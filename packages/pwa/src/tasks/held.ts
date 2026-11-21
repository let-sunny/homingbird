import { Task as T } from '@homingbird/kernel'
import { type Action, type App, withApp } from '../app.ts'
import type { HeldDecision } from '../state.ts'

/**
 * Holds a send or discard on the page for a moment before it is asked of the server, so that the person
 * can undo it; one held already is carried out first, since the person moved on from it.
 */
export const holdDecision = (decision: HeldDecision): Action =>
  T.gen(function* () {
    const { state } = yield* T.ask<App>()
    const earlier = state.held.get()
    state.held.set(decision)
    if (earlier !== null) yield* earlier.run
  })

/** Carries out the held decision: its moment is over, the person dismissed it, or the page is closing. */
export const commitHeld: Action = T.gen(function* () {
  const { state } = yield* T.ask<App>()
  const held = state.held.get()
  if (held === null) return
  state.held.set(null)
  yield* held.run
})

/** Forgets the held decision; nothing was asked of the server, so the card is back as it was. */
export const undoHeld: Action = withApp(({ state }) => T.sync(() => state.held.set(null)))
