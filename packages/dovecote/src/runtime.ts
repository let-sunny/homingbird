import { type Clock, Iter, Schedule, Task as T, makeQueue, pipe, systemClock } from '@homingbird/kernel'
import { makeClientMetadataDocuments } from './auth/client-metadata.ts'
import { type Fetch, developmentProvider, openIdConnectProvider } from './auth/identity-provider.ts'
import { isLoopbackHost } from './auth/redirect-policy.ts'
import { deleteExpiredAuthRequests } from './auth/requests.ts'
import type { Config } from './config.ts'
import { type AuditRecord, deleteAuditBefore } from './domain/audit.ts'
import { readSettings } from './domain/settings.ts'
import type { AppEnv } from './environment.ts'
import { deleteEventsBefore } from './events/events.ts'
import { PRESENCE_FLUSH_INTERVAL_MS, makeHub } from './events/hub.ts'
import { makeRateLimiter } from './http/rate-limiter.ts'
import { makePushNotifier, sendTestPush } from './push/notifier.ts'
import { cryptoRandom } from './random.ts'
import { type Database, sqlEnvironment } from './sql/database.ts'
import { makeWorkTally } from './work-tally.ts'

export interface Runtime {
  readonly env: AppEnv
  readonly background: T.Task<never, never, AppEnv>
  readonly settled: T.Task<void>
}

export interface RuntimeParts {
  readonly config: Config
  readonly database: Database
  readonly clock?: Clock
  readonly fetch?: Fetch
  readonly log?: (line: string) => void
}

export const buildRuntime = (parts: RuntimeParts): Runtime => {
  const clock = parts.clock ?? systemClock
  const fetch = parts.fetch ?? globalThis.fetch
  const log = parts.log ?? ((line: string) => process.stdout.write(`${line}\n`))
  const forwarder = auditForwarder(parts.config, fetch, log)
  const push = makePushNotifier(fetch)
  const env: AppEnv = {
    ...sqlEnvironment(parts.database),
    clock,
    config: parts.config,
    random: cryptoRandom,
    hub: makeHub(clock.now),
    rateLimiter: makeRateLimiter(clock.now),
    identityProvider: parts.config.identity.devLogin
      ? developmentProvider(parts.config.publicUrl)
      : openIdConnectProvider(parts.config.identity, {
          fetch,
          now: clock.now,
          log,
          allowsLoopback: isLoopbackHost(new URL(parts.config.publicUrl).hostname),
        }),
    clientMetadata: makeClientMetadataDocuments(fetch),
    auditSink: forwarder.accept,
    pushSink: push.consider,
    pushTest: (memberId) => sendTestPush(fetch, memberId),
    log,
  }
  return {
    env,
    background: T.race([housekeeping, presenceBroadcast, forwarder.run, push.run]),
    settled: T.gen(function* () {
      yield* push.settled
      yield* forwarder.settled
    }),
  }
}

export const housekeepingPass: T.Task<void, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  const now = env.clock.now()
  const settings = yield* readSettings
  yield* deleteExpiredAuthRequests(now)
  yield* deleteEventsBefore(now - EVENT_RETENTION_MS)
  if (settings.auditRetentionDays !== null)
    yield* deleteAuditBefore(now - settings.auditRetentionDays * DAY_MS)
})

export const housekeeping: T.Task<never, never, AppEnv> = T.forever(60 * 60_000)(housekeepingPass)

export const presenceBroadcast: T.Task<never, never, AppEnv> = T.forever(PRESENCE_FLUSH_INTERVAL_MS)(
  T.map((env: AppEnv) => env.hub.flushPresence())(T.ask<AppEnv>()),
)

const DAY_MS = 24 * 60 * 60_000
const EVENT_RETENTION_MS = 7 * DAY_MS
const WEBHOOK_BATCH = 100
const WEBHOOK_BUFFER = 10_000

const auditForwarder = (config: Config, fetch: Fetch, log: (line: string) => void) => {
  const pending = makeQueue<AuditRecord>(WEBHOOK_BUFFER)
  const work = makeWorkTally()
  const { toStdout, webhookUrl } = config.audit
  const deliver = (batch: ReadonlyArray<AuditRecord>): T.Task<void, never, { clock: Clock }> =>
    pipe(
      T.tryPromise(
        async (signal) => {
          const response = await fetch(webhookUrl!, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ entries: batch }),
            signal,
          })
          if (!response.ok) throw new Error(`status ${response.status}`)
        },
        (cause) => (cause as Error).message,
      ),
      T.retry({ schedule: () => pipe(Schedule.exponential(1_000, 2, 60_000), Iter.take(8)) }),
      T.catchAll((reason) => T.sync(() => log(`audit webhook: dropped ${batch.length} entries (${reason})`))),
    )
  return {
    accept: (record: AuditRecord): void => {
      if (toStdout) log(JSON.stringify({ type: 'audit', ...record }))
      if (webhookUrl === null) return
      if (pending.tryOffer(record)) work.started()
      else log('audit webhook: buffer full, entry dropped')
    },
    run: T.gen(function* () {
      for (;;) {
        const first = yield* T.orDie(pending.take)
        const batch = [first]
        while (batch.length < WEBHOOK_BATCH && pending.size() > 0) batch.push(yield* T.orDie(pending.take))
        try {
          yield* deliver(batch)
        } finally {
          for (const _ of batch) work.finished()
        }
      }
    }) as T.Task<never, never, { clock: Clock }>,
    settled: work.settled,
  }
}
