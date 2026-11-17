import { type Clock, Schedule, type Stream } from '@homingbird/kernel'
import { POLL_WAIT_MAX_SECONDS, STREAM_PATHS, StreamEvent } from '@homingbird/protocol'
import { type Fetch, type HttpApiOptions, authorizationHeaders } from './http-api.ts'
import { parseServerSentEvents } from './server-sent-events.ts'

export type Transport = 'sse' | 'poll'

export interface EventStreamOptions extends HttpApiOptions {
  readonly clock: Clock
  readonly after?: number
  readonly onTransport?: (transport: Transport) => void
}

export const FAILED_STREAMS_BEFORE_POLLING = 3

export const eventStream = (
  options: EventStreamOptions,
  signal: AbortSignal,
): Stream.Stream<StreamEvent> => ({
  async *[Symbol.asyncIterator]() {
    let cursor = options.after ?? null
    let failedStreams = 0
    const backoff = Schedule.exponential(500, 2, 30_000)
    while (!signal.aborted) {
      const transport: Transport = failedStreams >= FAILED_STREAMS_BEFORE_POLLING ? 'poll' : 'sse'
      options.onTransport?.(transport)
      let delivered = false
      try {
        const source =
          transport === 'sse' ? streamOnce(options, cursor, signal) : pollOnce(options, cursor ?? 0, signal)
        for await (const event of source) {
          delivered = true
          if (event.seq > 0) cursor = event.seq
          yield event
        }
      } catch {
        if (transport === 'sse' && !delivered) failedStreams += 1
      }
      if (delivered) failedStreams = transport === 'sse' ? 0 : failedStreams
      if (signal.aborted) return
      if (transport === 'sse' || !delivered) await options.clock.sleep(backoff.next().value, signal)
    }
  },
})

const streamOnce = async function* (
  options: EventStreamOptions,
  cursor: number | null,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const response = await fetchOf(options)(`${base(options)}${STREAM_PATHS.sse}`, {
    headers: {
      accept: 'text/event-stream',
      ...authorizationHeaders(options),
      ...(cursor !== null && { 'last-event-id': String(cursor) }),
    },
    ...(options.sendsCookies && { credentials: 'same-origin' as const }),
    signal,
  })
  if (!response.ok || response.body === null) throw new Error(`stream refused with status ${response.status}`)
  for await (const message of parseServerSentEvents(decodedChunks(response.body))) {
    const event = StreamEvent.decode(safeJson(message.data))
    if (event._tag === 'Ok') yield event.value
  }
}

const pollOnce = async function* (
  options: EventStreamOptions,
  cursor: number,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const response = await fetchOf(options)(
    `${base(options)}${STREAM_PATHS.poll}?after=${cursor}&wait=${POLL_WAIT_MAX_SECONDS}`,
    {
      headers: authorizationHeaders(options),
      ...(options.sendsCookies && { credentials: 'same-origin' as const }),
      signal,
    },
  )
  if (!response.ok) throw new Error(`poll refused with status ${response.status}`)
  const payload = (await response.json()) as { events?: ReadonlyArray<unknown> }
  for (const raw of payload.events ?? []) {
    const event = StreamEvent.decode(raw)
    if (event._tag === 'Ok') yield event.value
  }
}

const decodedChunks = async function* (body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      yield decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

const fetchOf = (options: EventStreamOptions): Fetch => options.fetch ?? globalThis.fetch

const base = (options: EventStreamOptions): string => options.serverUrl.replace(/\/+$/, '')

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
