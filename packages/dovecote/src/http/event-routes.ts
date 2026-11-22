import { Stream, Task as T, pipe } from '@homingbird/kernel'
import { type ApiError, HEARTBEAT_SECONDS, type StreamEvent, Unauthorized } from '@homingbird/protocol'
import { authenticate } from '../domain/credentials.ts'
import { touchLastSeen } from '../domain/members.ts'
import { readableEvents, readsPrivateQuestions } from '../domain/private-question-readers.ts'
import type { AppEnv, Caller } from '../environment.ts'
import { liveEvents } from '../events/events.ts'
import { callerOf, sessionToken } from './authenticate.ts'
import { type HttpRequest, type HttpResponse, apiFailure } from './exchange.ts'

export const handleEventStreamRequest = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.fold(
    (error: ApiError) => apiFailure(error),
    (frames: Stream.Stream<string>): HttpResponse => ({
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      },
      body: frames,
    }),
  )(
    T.gen(function* () {
      const caller = yield* callerOf(request)
      const token = tokenOf(request)
      if (caller === null || token === null)
        return yield* T.fail(Unauthorized({ message: 'Sign in to continue.' }))
      const feed = yield* memberFeed(caller, token, resumePoint(request), request.disconnected)
      return Stream.map(toServerSentFrame)(feed)
    }),
  )

export type FeedItem = StreamEvent | typeof HEARTBEAT

export const HEARTBEAT = Symbol('heartbeat')

export const memberFeed = (
  caller: Caller,
  token: string,
  after: number | null,
  disconnected: AbortSignal,
): T.Task<Stream.Stream<FeedItem>, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const ended = new AbortController()
    disconnected.addEventListener('abort', () => ended.abort(), { once: true })
    yield* touchLastSeen(caller.member.id)
    const live = yield* liveEvents(caller.member.id, caller.credential.kind, after, ended.signal)
    const events = readsPrivateQuestions(caller)
      ? live
      : pipe(
          live,
          Stream.flatMap((event: StreamEvent) =>
            Stream.fromTask(
              T.map((kept: StreamEvent[]) => Stream.fromIterable(kept))(readableEvents(caller, [event])),
              env,
              ended.signal,
            ),
          ),
        )
    const heartbeats = pipe(
      Stream.interval(env.clock, HEARTBEAT_SECONDS * 1000, ended.signal),
      Stream.map(() => T.runPromise(heartbeat(token, ended), env)),
    )
    return Stream.untilAborted(ended.signal)(Stream.merge<FeedItem>(events, heartbeats))
  })

export const resumePoint = (request: HttpRequest): number | null => {
  const raw = request.headers['last-event-id'] ?? request.query.get('after')
  return raw !== undefined && raw !== null && /^[0-9]{1,15}$/.test(raw) ? Number(raw) : null
}

export const tokenOf = (request: HttpRequest): string | null =>
  /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1] ?? sessionToken(request)

/** A heartbeat checks the credential again; one that fails to sign in ends the feed. */
const heartbeat = (token: string, ended: AbortController): T.Task<FeedItem, never, AppEnv> =>
  T.map((stillValid: T.Exit<unknown, unknown>): FeedItem => {
    if (stillValid._tag === 'Err') ended.abort()
    return HEARTBEAT
  })(T.exit(authenticate(token)))

const toServerSentFrame = (item: FeedItem): string =>
  item === HEARTBEAT
    ? ': keep-alive\n\n'
    : `${item.seq > 0 ? `id: ${item.seq}\n` : ''}event: ${item.body.type}\ndata: ${JSON.stringify(item)}\n\n`
