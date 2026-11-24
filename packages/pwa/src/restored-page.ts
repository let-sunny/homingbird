import { Task as T } from '@homingbird/kernel'
import type { App } from './app.ts'
import { USUAL_LOAD_SECONDS } from './load-timing.ts'
import { signedIn } from './state.ts'
import { requireSamePerson } from './tasks/same-person.ts'

/**
 * Keeps a page the browser brings back, as with the back button, from showing a person who signed out
 * meanwhile: it is hidden as it is left, and shown again once the server says the same person is signed
 * in. Anything else loads it anew.
 */
export const guardRestoredPage = (app: App, root: HTMLElement): void => {
  const { page, state } = app
  const show = (): void => {
    root.hidden = false
  }
  app.ended.addEventListener('abort', show, { once: true })
  page.on('pagehide', () => {
    root.hidden = true
  })
  page.onRestored(() => {
    if (signedIn(state) === null) return page.reload()
    T.runFork(
      T.fold(() => page.reload(), show)(T.timeout(USUAL_LOAD_SECONDS * 1000)(requireSamePerson)),
      app,
      app.ended,
    )
  })
}
