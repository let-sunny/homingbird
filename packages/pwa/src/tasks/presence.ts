import { Task as T } from '@homingbird/kernel'
import { type Action, withApp } from '../app.ts'

/**
 * Tells the server whether a person can see this page, so a minimised window or a background tab
 * still gets a push notification. A visible report is renewed while the page stays visible.
 */
export const reportVisibility: Action = withApp((app) =>
  T.sync(() => {
    const page = app.random.id()
    const stop = app.page.on('visibilitychange', () => app.launch(report(page)))
    app.ended.addEventListener('abort', stop, { once: true })
    T.runFork(
      T.forever(VISIBLE_RENEWAL_MS)(T.suspend(() => (app.page.isVisible() ? report(page) : T.unit))),
      app,
      app.ended,
    )
  }),
)

export const VISIBLE_RENEWAL_MS = 60_000

const report = (page: string): Action =>
  withApp(({ api, page: browser }) =>
    T.asUnit(
      T.catchAll(() => T.unit)(api['presence.visibility']({ body: { page, visible: browser.isVisible() } })),
    ),
  )
