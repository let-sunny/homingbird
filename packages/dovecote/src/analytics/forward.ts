import { type HasClock, Task as T, makeQueue } from '@homingbird/kernel'
import type { AnalyticsEvent } from '@homingbird/protocol'
import type { Fetch } from '../auth/identity-provider.ts'
import type { AnalyticsDestination } from '../config.ts'
import type { Log } from '../log/operational-log.ts'
import { makeWorkTally } from '../work-tally.ts'

/**
 * Sends checked product analytics to the operator's destination from a bounded queue in the background,
 * never inside the request that brought them. A full queue drops a batch and says so; a failed delivery
 * drops it too.
 */
export const makeAnalyticsForwarder = (
  destination: AnalyticsDestination,
  fetch: Fetch,
  log: Log,
): AnalyticsForwarder => {
  const pending = makeQueue<ReadonlyArray<AnalyticsEvent>>(QUEUE_LIMIT)
  const work = makeWorkTally()
  const deliver = (kind: 'posthog' | 'ga4' | 'http', delivery: Delivery): T.Task<void, never, HasClock> =>
    T.gen(function* () {
      const answered = yield* T.result(
        T.timeout(FORWARD_TIMEOUT_MS)(
          T.tryPromise(
            (signal) => fetch(delivery.url, { ...delivery.init, signal }),
            () => 'unreachable' as const,
          ),
        ),
      )
      const status = answered._tag === 'Ok' ? answered.value.status : 0
      if (status < 200 || status >= 300)
        log.emit({ name: 'analytics.forward_failed', attributes: { destination: kind, status } })
    })
  return {
    accept: (events) => {
      if (destination.kind === 'off') return
      if (pending.tryOffer(events)) work.started()
      else log.emit({ name: 'analytics.dropped', attributes: { count: events.length } })
    },
    run: T.gen(function* () {
      for (;;) {
        const events = yield* T.orDie(pending.take)
        try {
          if (destination.kind !== 'off')
            for (const delivery of deliveriesFor(destination, events))
              yield* deliver(destination.kind, delivery)
        } finally {
          work.finished()
        }
      }
    }) as T.Task<never, never, HasClock>,
    settled: work.settled,
  }
}

export interface AnalyticsForwarder {
  readonly accept: (events: ReadonlyArray<AnalyticsEvent>) => void
  readonly run: T.Task<never, never, HasClock>
  readonly settled: T.Task<void>
}

export interface Delivery {
  readonly url: string
  readonly init: {
    readonly method: 'POST'
    readonly headers: Readonly<Record<string, string>>
    readonly body: string
  }
}

/** The requests each destination expects, as data: PostHog's batch capture, GA4's Measurement Protocol, ours. */
export const deliveriesFor = (
  destination: Exclude<AnalyticsDestination, { readonly kind: 'off' }>,
  events: ReadonlyArray<AnalyticsEvent>,
): ReadonlyArray<Delivery> => {
  if (destination.kind === 'posthog')
    return [
      post(
        `${destination.url}/batch/`,
        {},
        {
          api_key: destination.key,
          batch: events.map((event) => ({
            event: event.event,
            distinct_id: event.anonymousId,
            properties: { ...event.properties, $process_person_profile: false },
            timestamp: new Date(event.timestamp).toISOString(),
          })),
        },
      ),
    ]
  if (destination.kind === 'ga4') {
    const url = new URL(destination.url)
    url.searchParams.set('api_secret', destination.key ?? '')
    return [...new Set(events.map((event) => event.anonymousId))].map((anonymousId) =>
      post(
        url.toString(),
        {},
        {
          client_id: anonymousId,
          events: events
            .filter((event) => event.anonymousId === anonymousId)
            .map((event) => ({
              name: event.event,
              params: { ...event.properties, engagement_time_msec: 1 },
              timestamp_micros: event.timestamp * 1000,
            })),
        },
      ),
    )
  }
  return [
    post(destination.url, destination.key === null ? {} : { authorization: `Bearer ${destination.key}` }, {
      events,
    }),
  ]
}

const FORWARD_TIMEOUT_MS = 5_000
const QUEUE_LIMIT = 1_000

const post = (url: string, headers: Readonly<Record<string, string>>, body: unknown): Delivery => ({
  url,
  init: {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  },
})
