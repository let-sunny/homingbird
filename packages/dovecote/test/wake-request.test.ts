import { Task as T, makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { WAKE_TIMEOUT_MS, sendWake } from '../src/wake/wake-request.ts'

const TARGET = {
  url: 'https://api.anthropic.com/v1/claude_code/routines/trig_01/fire',
  headers: [
    { name: 'Authorization', value: 'Bearer sk-ant-oat01-secret' },
    { name: 'anthropic-version', value: '2023-06-01' },
  ],
}

const wakeWith = (answer: (init: RequestInit) => Promise<Response>) => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetch = (url: string, init?: RequestInit) => {
    calls.push({ url, init: init! })
    return answer(init!)
  }
  return { calls, wake: sendWake(fetch, TARGET, 'https://hb.example.com') }
}

describe('a wake request', () => {
  it('posts the fixed body with the person’s headers, sets its own content type and follows no redirect', async () => {
    const { calls, wake } = wakeWith(async () => new Response('{"session":"x"}', { status: 200 }))
    expect(await T.runPromise(wake, { clock: makeTestClock() })).toEqual({ status: 200, retryAfter: null })
    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }]
    expect(url).toBe(TARGET.url)
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(init.headers).toEqual({
      Authorization: 'Bearer sk-ant-oat01-secret',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'Homingbird: work is waiting at https://hb.example.com.',
    })
  })

  it('cancels the answer’s body unread and keeps only the status and Retry-After', async () => {
    let cancelled = false
    const body = new ReadableStream({ cancel: () => void (cancelled = true) })
    const { wake } = wakeWith(
      async () => new Response(body, { status: 429, headers: { 'retry-after': '60' } }),
    )
    expect(await T.runPromise(wake, { clock: makeTestClock() })).toEqual({ status: 429, retryAfter: '60' })
    expect(cancelled).toBe(true)
  })

  it('reads a redirect as its own status, without following it', async () => {
    const { calls, wake } = wakeWith(
      async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    )
    expect(await T.runPromise(wake, { clock: makeTestClock() })).toEqual({ status: 302, retryAfter: null })
    expect(calls).toHaveLength(1)
  })

  it('says 0 when the service cannot be reached', async () => {
    const { wake } = wakeWith(() => Promise.reject(new TypeError('fetch failed')))
    expect(await T.runPromise(wake, { clock: makeTestClock() })).toEqual({ status: 0, retryAfter: null })
  })

  it('gives up after ten seconds, aborting the request, and calls it a timeout', async () => {
    const clock = makeTestClock()
    let aborted = false
    const { wake } = wakeWith(
      (init) =>
        new Promise<Response>(() => {
          init.signal?.addEventListener('abort', () => void (aborted = true))
        }),
    )
    const running = T.runPromise(wake, { clock })
    expect(WAKE_TIMEOUT_MS).toBe(10_000)
    await clock.advance(WAKE_TIMEOUT_MS)
    expect(await running).toBe('timeout')
    expect(aborted).toBe(true)
  })
})
