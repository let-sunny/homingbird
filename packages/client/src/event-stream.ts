import { type Clock, type HasClock, Schedule, Stream, Task as T, isOk, tagged } from '@homingbird/kernel'
import {
  API_PREFIX,
  type AsRead,
  POLL_WAIT_MAX_SECONDS,
  STREAM_PATHS,
  StreamEvent,
  UNKNOWN,
  contract,
} from '@homingbird/protocol'
import { type Fetch, type HttpApiOptions, authorizationHeaders } from './http-api.ts'
import { type ServerSentMessage, parseServerSentEvents } from './server-sent-events.ts'

export type Transport = 'sse' | 'poll'

export interface EventStreamOptions extends HttpApiOptions {
  readonly clock: Clock
  readonly after?: number
  readonly onTransport?: (transport: Transport) => void
  /** Told when an event does not read; the stream skips it and moves past it. */
  readonly onUnreadable?: (problem: string) => void
  /** False for a person's web client, whose session takes part in no debate room; true by default. */
  readonly heartbeat?: boolean
  /** Also delivers `resync` on each stream connect and on the first poll that answers after a failure. */
  readonly resyncOnConnect?: boolean
  readonly onRevoked?: () => void
}

export const FAILED_STREAMS_BEFORE_POLLING = 3

export const REFUSALS_BEFORE_REVOKED = 3

/**
 * How often a client holding the stream sends `presence.heartbeat`: the server counts an agent as taking
 * part by its requests only, since a half-open stream looks held for many minutes.
 */
export const STREAM_HEARTBEAT_MS = 60_000

/**
 * Delivers the member's events, over server-sent events or, after repeated failures, long-polling, and
 * sends a heartbeat request every `STREAM_HEARTBEAT_MS` for as long as it is read.
 */
export const eventStream = (
  options: EventStreamOptions,
  signal: AbortSignal,
): Stream.Stream<AsRead.KnownEvent> =>
  Stream.fromEmitter(
    (emit) =>
      T.scoped((scope) =>
        T.flatMap(() => deliverEvents(options, emit))(
          options.heartbeat === false ? T.unit : scope.fork(heartbeats(options)),
        ),
      ),
    { clock: options.clock },
    signal,
  )

const deliverEvents = (
  options: EventStreamOptions,
  emit: (event: AsRead.KnownEvent) => T.Task<void>,
): T.Task<never, never, HasClock> =>
  T.gen(function* () {
    let cursor = options.after ?? null
    let failedStreams = 0
    let backoff = reconnectDelays()
    let isResyncDue = true
    let refusedInRow = 0
    for (;;) {
      const transport: Transport = failedStreams >= FAILED_STREAMS_BEFORE_POLLING ? 'poll' : 'sse'
      options.onTransport?.(transport)
      let delivered = false
      const deliver = (arrived: Arrived): T.Task<void> => {
        delivered = true
        if (arrived.seq !== null && arrived.seq > 0) cursor = arrived.seq
        if (arrived.event === null) options.onUnreadable?.(UNREADABLE_PROBLEM)
        else if (isKnownEvent(arrived.event)) return emit(arrived.event)
        return T.unit
      }
      const connected = T.suspend(() => {
        const isDue = options.resyncOnConnect === true && (transport === 'sse' || isResyncDue)
        isResyncDue = false
        return isDue ? emit(resyncAt(options.clock.now())) : T.unit
      })
      const attempt =
        transport === 'sse'
          ? T.flatMap((arrivals: Stream.Stream<Arrived>) =>
              T.flatMap(() => Stream.forEach(deliver)(arrivals))(connected),
            )(streamOnce(options, cursor))
          : T.gen(function* () {
              const polled = yield* pollOnce(options, cursor ?? 0)
              for (const arrived of polled.arrivals) yield* deliver(arrived)
              if (polled.cursor !== null) cursor = polled.cursor
              yield* connected
            })
      const exit = yield* T.exit(attempt)
      const failed = !isOk(exit)
      refusedInRow = isUnauthorized(exit) ? refusedInRow + 1 : 0
      if (refusedInRow === REFUSALS_BEFORE_REVOKED) options.onRevoked?.()
      if (failed) isResyncDue = true
      if (delivered) backoff = reconnectDelays()
      if (transport === 'sse') failedStreams = delivered ? 0 : failed ? failedStreams + 1 : failedStreams
      if (failed || transport === 'sse') yield* T.sleep(backoff.next().value)
      else if (!delivered) yield* T.sleep(EMPTY_POLL_PAUSE_MS)
    }
  })

/** A server older than the heartbeat answers 404, and a failed heartbeat waits for the next one. */
const heartbeats = (options: EventStreamOptions): T.Task<never, never, HasClock> =>
  T.flatMap(() => T.forever(STREAM_HEARTBEAT_MS)(heartbeat(options)))(T.sleep(STREAM_HEARTBEAT_MS))

const heartbeat = (options: EventStreamOptions): T.Task<void> =>
  T.asUnit(
    T.exit(
      T.gen(function* () {
        const response = yield* T.promise((signal) =>
          fetchOf(options)(`${base(options)}${API_PREFIX}${contract['presence.heartbeat'].path}`, {
            headers: authorizationHeaders(options),
            ...(options.sendsCookies && { credentials: 'same-origin' as const }),
            signal,
          }),
        )
        yield* T.promise(() => response.body?.cancel() ?? Promise.resolve())
      }),
    ),
  )

const EMPTY_POLL_PAUSE_MS = 1_000

const resyncAt = (at: number): AsRead.KnownEvent => ({ seq: 0, at, body: { type: 'resync' } })

/** An event of a kind a newer server added still moves the cursor past it, and is then skipped. */
const isKnownEvent = (event: AsRead.StreamEvent): event is AsRead.KnownEvent => event.body.type !== UNKNOWN

const reconnectDelays = () => Schedule.exponential(500, 2, 30_000)

const StreamRefused = tagged('StreamRefused')<{ readonly status: number }>()
type StreamRefused = ReturnType<typeof StreamRefused>

const isUnauthorized = (exit: T.Exit<unknown, StreamRefused>): boolean =>
  exit._tag === 'Err' && exit.error._tag === 'Fail' && exit.error.error.status === 401

const streamOnce = (
  options: EventStreamOptions,
  cursor: number | null,
): T.Task<Stream.Stream<Arrived>, StreamRefused> =>
  T.gen(function* () {
    const response = yield* T.promise((signal) =>
      fetchOf(options)(`${base(options)}${STREAM_PATHS.sse}`, {
        headers: {
          accept: 'text/event-stream',
          ...authorizationHeaders(options),
          ...(cursor !== null && { 'last-event-id': String(cursor) }),
        },
        ...(options.sendsCookies && { credentials: 'same-origin' as const }),
        signal,
      }),
    )
    if (!response.ok || response.body === null)
      return yield* T.fail(StreamRefused({ status: response.status }))
    const body = response.body
    return Stream.map((message: ServerSentMessage) => arrivedFrom(safeJson(message.data)))(
      parseServerSentEvents(decodedChunks(body)),
    )
  })

interface Polled {
  readonly arrivals: ReadonlyArray<Arrived>
  readonly cursor: number | null
}

const pollOnce = (options: EventStreamOptions, cursor: number): T.Task<Polled, StreamRefused> =>
  T.gen(function* () {
    const response = yield* T.promise((signal) =>
      fetchOf(options)(`${base(options)}${STREAM_PATHS.poll}?after=${cursor}&wait=${POLL_WAIT_MAX_SECONDS}`, {
        headers: authorizationHeaders(options),
        ...(options.sendsCookies && { credentials: 'same-origin' as const }),
        signal,
      }),
    )
    if (!response.ok) return yield* T.fail(StreamRefused({ status: response.status }))
    const payload = (yield* T.promise(() => response.json())) as {
      events?: ReadonlyArray<unknown>
      cursor?: unknown
    }
    const next = payload.cursor
    return {
      arrivals: (payload.events ?? []).map(arrivedFrom),
      cursor: typeof next === 'number' && Number.isSafeInteger(next) && next >= 0 ? next : null,
    }
  })

const UNREADABLE_PROBLEM = 'The server sent an event this client cannot read; it was skipped.'

interface Arrived {
  readonly event: AsRead.StreamEvent | null
  readonly seq: number | null
}

/** An event that does not read still moves the cursor past it when its sequence number reads. */
const arrivedFrom = (raw: unknown): Arrived => {
  const event = StreamEvent.read(raw)
  if (event._tag === 'Ok') return { event: event.value, seq: event.value.seq }
  const seq = (raw as { readonly seq?: unknown } | null)?.seq
  return { event: null, seq: typeof seq === 'number' && Number.isSafeInteger(seq) ? seq : null }
}

const decodedChunks = (body: ReadableStream<Uint8Array>): Stream.Stream<string> =>
  Stream.fromEmitter(
    (emit) =>
      T.gen(function* () {
        const decoder = new TextDecoder()
        const reader = body.getReader()
        try {
          for (;;) {
            const { done, value } = yield* T.promise(() => reader.read())
            if (done) return
            yield* emit(decoder.decode(value, { stream: true }))
          }
        } finally {
          reader.releaseLock()
        }
      }),
    undefined,
    T.NEVER_ABORTED,
  )

const fetchOf = (options: EventStreamOptions): Fetch => options.fetch ?? globalThis.fetch

const base = (options: EventStreamOptions): string => options.serverUrl.replace(/\/+$/, '')

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
