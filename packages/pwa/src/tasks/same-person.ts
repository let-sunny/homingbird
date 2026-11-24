import { Task as T } from '@homingbird/kernel'
import type { Action, App } from '../app.ts'
import { signedIn } from '../state.ts'

/**
 * Asks the server who is signed in, and starts the page anew when that is no longer the person it shows:
 * they signed out, and perhaps another person signed in, in another tab.
 */
export const requireSamePerson: Action = T.gen(function* () {
  const { api, state, page, endSession } = yield* T.ask<App>()
  const { member } = yield* api['me.get']({})
  if (member.id === signedIn(state)?.member.id) return
  endSession()
  page.reload()
  yield* T.interrupt
})
