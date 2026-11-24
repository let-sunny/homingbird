import { eventStream } from '@homingbird/client'
import { Stream, Task as T } from '@homingbird/kernel'
import { type AsRead, STREAM_PATHS } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { liveEvents } from './live.ts'
import { type CatchUp, catchUp } from './reconnect.ts'

/**
 * Follows the person's live events after the given one, resuming from where it left off, stopping while
 * offline and for good once the session ends.
 */
export const followEvents = (after: number): Action =>
  withApp((app) =>
    T.sync(() => {
      const apply = liveEvents(app)
      const missed = catchUp(app)
      let lastSeq = after
      let running = new AbortController()
      const follow = (): void => {
        const { signal } = running
        const events = eventStream(
          {
            serverUrl: app.page.origin,
            sendsCookies: true,
            heartbeat: false,
            clock: app.clock,
            fetch: reportingConnection(app, missed, signal),
            after: lastSeq,
          },
          signal,
        )
        T.runFork(
          Stream.forEach((event: AsRead.StreamEvent) =>
            T.sync(() => {
              if (event.seq > 0) lastSeq = event.seq
              apply(event)
            }),
          )(events),
          undefined,
          signal,
        )
      }
      const stopFollowing = [
        app.page.on('offline', () => {
          running.abort()
          app.state.connection.set('offline')
          missed.lost()
        }),
        app.page.on('online', () => {
          running.abort()
          running = new AbortController()
          app.state.connection.set('connecting')
          follow()
        }),
        () => running.abort(),
      ]
      app.ended.addEventListener('abort', () => stopFollowing.forEach((stop) => stop()), { once: true })
      follow()
    }),
  )

/**
 * The number of the person's newest event. Taken before the page loads anything, it is where `followEvents`
 * starts, so a change made during the load is in the load, in the events after it, or in both.
 */
export const latestEvent: Action<number> = withApp(({ api }) =>
  T.map((polled: { cursor: number }) => polled.cursor)(
    api['events.poll']({ query: { after: PAST_EVERY_EVENT } }),
  ),
)

/**
 * The page's fetch, noting whether the event stream is live, polling or offline as each answer comes, and
 * what was missed. A refused session ends at once.
 */
const reportingConnection =
  (app: App, missed: CatchUp, followed: AbortSignal) =>
  (url: string, init?: RequestInit): Promise<Response> => {
    const transport = url.includes(STREAM_PATHS.poll) ? 'poll' : 'stream'
    const disconnected = (): void => {
      app.state.connection.set('offline')
      missed.lost()
    }
    missed.asking(transport)
    return app.page.fetch(url, init).then(
      (response) => {
        if (followed.aborted) return response
        if (response.status === 401) app.endSession()
        else if (!response.ok) disconnected()
        else {
          app.state.connection.set(transport === 'poll' ? 'polling' : 'live')
          missed.answered(transport)
        }
        return response
      },
      (error: unknown) => {
        if (!followed.aborted) disconnected()
        throw error
      },
    )
  }

/** The server answers a poll from past the end with no events and its newest one's number. */
const PAST_EVERY_EVENT = '999999999999999'
