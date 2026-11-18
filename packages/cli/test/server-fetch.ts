import type { Fetch } from '@homingbird/client'
import { PUBLIC_URL, type TestServer } from '../../dovecote/test/harness.ts'

export const SERVER_URL = PUBLIC_URL

export interface RecordedCall {
  readonly method: string
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

export const fetchThrough =
  (server: TestServer, recorded: RecordedCall[] = []): Fetch =>
  async (url, init = {}) => {
    const method = init.method ?? 'GET'
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    const body = typeof init.body === 'string' ? init.body : ''
    recorded.push({ method, path: new URL(url).pathname, headers, body })
    const isForm = (headers['content-type'] ?? '').includes('x-www-form-urlencoded')
    const answer = await server.request(method, url, {
      headers,
      ...(isForm && { form: Object.fromEntries(new URLSearchParams(body)) }),
      ...(!isForm && body !== '' && { body: JSON.parse(body) }),
      ...(init.signal && { signal: init.signal }),
    })
    const raw = answer.raw.body
    if (typeof raw === 'string' || raw instanceof Uint8Array)
      return new Response(answer.status === 204 ? null : raw, {
        status: answer.status,
        headers: answer.headers,
      })
    return new Response(streamOf(raw, init.signal ?? null), {
      status: answer.status,
      headers: answer.headers,
    })
  }

const streamOf = (chunks: AsyncIterable<string>, signal: AbortSignal | null): ReadableStream<Uint8Array> => {
  const iterator = chunks[Symbol.asyncIterator]()
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      signal?.addEventListener('abort', () => {
        try {
          controller.error(new Error('aborted'))
        } catch {}
      })
    },
    pull: async (controller) => {
      const step = await iterator.next()
      if (step.done) controller.close()
      else controller.enqueue(encoder.encode(step.value))
    },
    cancel: async () => {
      await iterator.return?.()
    },
  })
}
