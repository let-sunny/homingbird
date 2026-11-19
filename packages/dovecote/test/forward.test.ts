import { Task as T, makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { deliveriesFor, makeAnalyticsForwarder } from '../src/analytics/forward.ts'
import { makeTestLog } from '../src/log/operational-log.ts'

const event = (anonymousId: string, page = 'home') => ({
  event: 'page_viewed',
  properties: { page },
  anonymousId,
  timestamp: 1_000,
})

describe('analytics destinations', () => {
  it('posts GA4 Measurement Protocol events, one request per anonymous id, with the API secret', () => {
    const [first, second] = deliveriesFor(
      { kind: 'ga4', url: 'https://www.google-analytics.com/mp/collect?measurement_id=G-ABC1', key: 's3' },
      [event('anon-aaaaaaaa'), event('anon-bbbbbbbb'), event('anon-aaaaaaaa', 'people')],
    )
    expect(first!.url).toBe('https://www.google-analytics.com/mp/collect?measurement_id=G-ABC1&api_secret=s3')
    expect(JSON.parse(first!.init.body)).toEqual({
      client_id: 'anon-aaaaaaaa',
      events: [
        {
          name: 'page_viewed',
          params: { page: 'home', engagement_time_msec: 1 },
          timestamp_micros: 1_000_000,
        },
        {
          name: 'page_viewed',
          params: { page: 'people', engagement_time_msec: 1 },
          timestamp_micros: 1_000_000,
        },
      ],
    })
    expect(JSON.parse(second!.init.body).client_id).toBe('anon-bbbbbbbb')
  })

  it('posts our own Segment-shaped batch to a generic address, with a bearer key when one is set', () => {
    const [keyed] = deliveriesFor({ kind: 'http', url: 'https://collect.example/in', key: 'k1' }, [
      event('anon-aaaaaaaa'),
    ])
    expect(keyed).toEqual({
      url: 'https://collect.example/in',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer k1' },
        body: JSON.stringify({ events: [event('anon-aaaaaaaa')] }),
      },
    })
    const [open] = deliveriesFor({ kind: 'http', url: 'https://collect.example/in', key: null }, [
      event('anon-aaaaaaaa'),
    ])
    expect(open!.init.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('queues in the background, sends nothing when off, and logs a destination that cannot be reached', async () => {
    const test = makeTestLog()
    let calls = 0
    const unreachable = (async () => {
      calls++
      throw new TypeError('fetch failed')
    }) as never
    const clock = makeTestClock(0)
    const off = makeAnalyticsForwarder({ kind: 'off' }, unreachable, test.log)
    off.accept([event('anon-aaaaaaaa')])
    await T.runPromise(off.settled)
    expect(calls).toBe(0)
    const http = makeAnalyticsForwarder(
      { kind: 'http', url: 'https://collect.example/in', key: null },
      unreachable,
      test.log,
    )
    http.accept([event('anon-aaaaaaaa')])
    expect(calls).toBe(0)
    const running = T.runFork(http.run, { clock })
    await T.runPromise(http.settled)
    await running.interrupt()
    expect(calls).toBe(1)
    expect(test.events()).toMatchObject([
      { eventName: 'analytics.forward_failed', attributes: { destination: 'http', status: 0 } },
    ])
  })

  it('drops a batch and says so when the queue is full, never holding the request', async () => {
    const test = makeTestLog()
    const forwarder = makeAnalyticsForwarder(
      { kind: 'http', url: 'https://collect.example/in', key: null },
      (async () => new Response(null, { status: 204 })) as never,
      test.log,
    )
    for (let batch = 0; batch < 1_001; batch++) forwarder.accept([event('anon-aaaaaaaa')])
    expect(test.events()).toMatchObject([{ eventName: 'analytics.dropped', attributes: { count: 1 } }])
    const running = T.runFork(forwarder.run, { clock: makeTestClock(0) })
    await T.runPromise(forwarder.settled)
    await running.interrupt()
    expect(test.events()).toHaveLength(1)
  })
})
