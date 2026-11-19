import { eventStream } from '@homingbird/client'
import { Stream, Task as T } from '@homingbird/kernel'
import { type AsRead, STREAM_PATHS } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { liveEvents } from './live.ts'

/** Follows the person's live events from where it left off, stopping while offline. */
export const followEvents: Action = withApp((app) =>
  T.sync(() => {
    const apply = liveEvents(app)
    let lastSeq: number | null = null
    let running = new AbortController()
    const follow = (): void => {
      const events = eventStream(
        {
          serverUrl: app.page.origin,
          sendsCookies: true,
          heartbeat: false,
          clock: app.clock,
          fetch: reportingConnection(app),
          ...(lastSeq !== null && { after: lastSeq }),
        },
        running.signal,
      )
      T.runFork(
        Stream.forEach((event: AsRead.StreamEvent) =>
          T.sync(() => {
            if (event.seq > 0) lastSeq = event.seq
            apply(event)
          }),
        )(events),
      )
    }
    app.page.on('offline', () => {
      running.abort()
      app.state.connection.set('offline')
    })
    app.page.on('online', () => {
      running.abort()
      running = new AbortController()
      app.state.connection.set('connecting')
      follow()
    })
    follow()
  }),
)

/** The page's fetch, noting whether the event stream is live, polling or offline as each answer comes. */
const reportingConnection =
  (app: App) =>
  (url: string, init?: RequestInit): Promise<Response> =>
    app.page.fetch(url, init).then(
      (response) => {
        app.state.connection.set(
          !response.ok ? 'offline' : url.includes(STREAM_PATHS.poll) ? 'polling' : 'live',
        )
        return response
      },
      (error: unknown) => {
        if (init?.signal?.aborted !== true) app.state.connection.set('offline')
        throw error
      },
    )
