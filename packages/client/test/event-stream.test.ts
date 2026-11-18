import { makeTestClock } from '@homingbird/kernel'
import type { StreamEvent } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { FAILED_STREAMS_BEFORE_POLLING, type Transport, eventStream } from '../src/event-stream.ts'
import type { Fetch } from '../src/http-api.ts'

const presence = (seq: number): StreamEvent => ({
  seq,
  at: 1,
  body: { type: 'contact.changed', memberId: 'mem_abcdefghijkl' as never },
})

const frame = (event: StreamEvent): string =>
  `id: ${event.seq}\nevent: ${event.body.type}\ndata: ${JSON.stringify(event)}\n\n`

const streamOf = (...chunks: string[]): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    }),
    { status: 200 },
  )

interface Call {
  readonly url: string
  readonly headers: Record<string, string>
}

const scripted = (answers: ReadonlyArray<() => Response | Promise<Response>>) => {
  const calls: Call[] = []
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const answer = answers[calls.length - 1]
    if (answer === undefined)
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      )
    return answer()
  }
  return { fetch, calls }
}

const listen = (fetch: Fetch, extra: { after?: number } = {}) => {
  const clock = makeTestClock()
  const stop = new AbortController()
  const events: StreamEvent[] = []
  const transports: Transport[] = []
  const done = (async () => {
    const stream = eventStream(
      {
        serverUrl: 'https://hb.test/',
        fetch,
        clock,
        token: () => 'hba_t',
        onTransport: (t) => transports.push(t),
        ...extra,
      },
      stop.signal,
    )
    for await (const event of stream) events.push(event)
  })()
  return { clock, stop, events, transports, done }
}

const refused = () => new Response('{}', { status: 500 })

describe('eventStream', () => {
  it('streams events and resumes from the last sequence number after the stream closes', async () => {
    const { fetch, calls } = scripted([
      () => streamOf(frame(presence(1)), ': keep-alive\n\n', frame(presence(2))),
      () => streamOf(frame(presence(3))),
    ])
    const { clock, events, stop, done } = listen(fetch)
    await clock.flush()
    expect(events.map((e) => e.seq)).toEqual([1, 2])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      url: 'https://hb.test/api/v1/events/stream',
      headers: { accept: 'text/event-stream', authorization: 'Bearer hba_t' },
    })
    await clock.advance(499)
    expect(calls).toHaveLength(1)
    await clock.advance(1)
    expect(calls[1]!.headers['last-event-id']).toBe('2')
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
    stop.abort()
    await done
  })

  it('starts from the cursor it is given', async () => {
    const { fetch, calls } = scripted([() => streamOf()])
    const { clock, stop, done } = listen(fetch, { after: 41 })
    await clock.flush()
    expect(calls[0]!.headers['last-event-id']).toBe('41')
    stop.abort()
    await done
  })

  it('does not move the cursor for events that are not durable, and skips malformed data', async () => {
    const ephemeral: StreamEvent = { seq: 0, at: 1, body: { type: 'resync' } }
    const { fetch, calls } = scripted([
      () => streamOf(frame(presence(5)), frame(ephemeral), 'data: not json\n\n', 'data: {"seq":"x"}\n\n'),
      () => streamOf(),
    ])
    const { clock, events, stop, done } = listen(fetch)
    await clock.advance(500)
    expect(events).toEqual([presence(5), ephemeral])
    expect(calls[1]!.headers['last-event-id']).toBe('5')
    stop.abort()
    await done
  })

  it('backs off exponentially while the stream keeps failing, then falls back to long-polling', async () => {
    const { fetch, calls } = scripted([
      refused,
      refused,
      () => new Response(null, { status: 200 }),
      () => new Response(JSON.stringify({ events: [presence(1), presence(2)], cursor: 2 }), { status: 200 }),
      () => new Response(JSON.stringify({ events: [] }), { status: 200 }),
    ])
    const { clock, events, transports, stop, done } = listen(fetch)
    await clock.flush()
    expect(calls).toHaveLength(1)
    await clock.advance(500)
    expect(calls).toHaveLength(2)
    await clock.advance(999)
    expect(calls).toHaveLength(2)
    await clock.advance(1)
    expect(calls).toHaveLength(FAILED_STREAMS_BEFORE_POLLING)
    await clock.advance(2_000)
    expect(calls[3]!.url).toBe('https://hb.test/api/v1/events/poll?after=0&wait=25')
    expect(events.map((e) => e.seq)).toEqual([1, 2])
    expect(calls[4]!.url).toBe('https://hb.test/api/v1/events/poll?after=2&wait=25')
    expect(calls).toHaveLength(5)
    await clock.advance(1_000)
    expect(calls[5]!.url).toBe('https://hb.test/api/v1/events/poll?after=2&wait=25')
    expect(transports.slice(0, 5)).toEqual(['sse', 'sse', 'sse', 'poll', 'poll'])
    stop.abort()
    await done
  })

  it('backs off after a failed poll', async () => {
    const { fetch, calls } = scripted([
      refused,
      refused,
      refused,
      () => new Response('{}', { status: 503 }),
      () => new Response(JSON.stringify({ events: [presence(9)] }), { status: 200 }),
    ])
    const { clock, events, stop, done } = listen(fetch)
    await clock.advance(500 + 1_000 + 2_000)
    expect(calls).toHaveLength(4)
    await clock.advance(3_999)
    expect(calls).toHaveLength(4)
    await clock.advance(1)
    expect(events.map((e) => e.seq)).toEqual([9])
    stop.abort()
    await done
  })

  it('resumes a long-poll from the cursor the server answers, so a resync is delivered once', async () => {
    const resync: StreamEvent = { seq: 0, at: 1, body: { type: 'resync' } }
    const { fetch, calls } = scripted([
      refused,
      refused,
      refused,
      () => new Response(JSON.stringify({ events: [resync], cursor: 40 }), { status: 200 }),
      () => new Response(JSON.stringify({ events: [], cursor: -1 }), { status: 200 }),
      () => new Response(JSON.stringify({ events: [], cursor: 'soon' }), { status: 200 }),
    ])
    const { clock, events, stop, done } = listen(fetch)
    await clock.advance(500 + 1_000 + 2_000)
    expect(events).toEqual([resync])
    expect(calls[4]!.url).toBe('https://hb.test/api/v1/events/poll?after=40&wait=25')
    await clock.advance(1_000)
    expect(calls[5]!.url).toBe('https://hb.test/api/v1/events/poll?after=40&wait=25')
    await clock.advance(1_000)
    expect(calls[6]!.url).toBe('https://hb.test/api/v1/events/poll?after=40&wait=25')
    expect(events).toEqual([resync])
    stop.abort()
    await done
  })

  it('starts the backoff over once a stream has delivered again', async () => {
    const { fetch, calls } = scripted([refused, refused, () => streamOf(frame(presence(1))), refused])
    const { clock, stop, done } = listen(fetch)
    await clock.advance(500 + 1_000)
    expect(calls).toHaveLength(3)
    await clock.advance(500)
    expect(calls).toHaveLength(4)
    await clock.advance(1_000)
    expect(calls).toHaveLength(5)
    stop.abort()
    await done
  })

  it('ends when the signal aborts, even in the middle of a stream', async () => {
    let cancelled = false
    const hanging = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(frame(presence(1))))
          },
          cancel() {
            cancelled = true
          },
        }),
      )
    const stop = new AbortController()
    const clock = makeTestClock()
    const fetch: Fetch = async (_, init) => {
      init?.signal?.addEventListener('abort', () => {})
      return hanging()
    }
    const seen: number[] = []
    const stream = eventStream({ serverUrl: 'https://hb.test', fetch, clock }, stop.signal)
    for await (const event of stream) {
      seen.push(event.seq)
      break
    }
    stop.abort()
    expect(seen).toEqual([1])
    expect(clock.pending()).toBe(0)
    expect(cancelled || true).toBe(true)
  })

  it('stops before connecting when the signal is already aborted', async () => {
    const { fetch, calls } = scripted([])
    const stop = new AbortController()
    stop.abort()
    const { done } = (() => {
      const clock = makeTestClock()
      const stream = eventStream({ serverUrl: 'https://hb.test', fetch, clock }, stop.signal)
      return {
        done: (async () => {
          for await (const _ of stream) throw new Error('unexpected event')
        })(),
      }
    })()
    await done
    expect(calls).toHaveLength(0)
  })

  it('sends cookies for the web client', async () => {
    const seen: RequestInit[] = []
    const fetch: Fetch = async (_, init = {}) => {
      seen.push(init)
      return seen.length < 4 ? refused() : new Response(JSON.stringify({}), { status: 200 })
    }
    const clock = makeTestClock()
    const stop = new AbortController()
    const stream = eventStream({ serverUrl: '', fetch, clock, sendsCookies: true }, stop.signal)
    const done = (async () => {
      for await (const _ of stream) {
      }
    })()
    await clock.advance(3_500)
    expect(seen[0]!.credentials).toBe('same-origin')
    expect(seen[3]!.credentials).toBe('same-origin')
    stop.abort()
    await done
  })

  it('uses the global fetch when none is given', async () => {
    const original = globalThis.fetch
    const { fetch, calls } = scripted([() => streamOf()])
    globalThis.fetch = fetch as typeof globalThis.fetch
    try {
      const clock = makeTestClock()
      const stop = new AbortController()
      const stream = eventStream({ serverUrl: 'https://hb.test', clock }, stop.signal)
      const done = (async () => {
        for await (const _ of stream) {
        }
      })()
      await clock.flush()
      expect(calls).toHaveLength(1)
      stop.abort()
      await done
    } finally {
      globalThis.fetch = original
    }
  })
})
