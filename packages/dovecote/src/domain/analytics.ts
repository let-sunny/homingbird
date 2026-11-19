import { createHmac } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import { type AnalyticsEvent, Invalid, RateLimited, checkAnalyticsEvent } from '@homingbird/protocol'
import type { AppEnv, Caller } from '../environment.ts'
import { LIMITS } from '../http/rate-limiter.ts'
import { type HasSql, dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, sql } from '../sql/query.ts'

/** Checks a batch, all or nothing, and queues it with each anonymous id re-keyed by an HMAC. */
export const trackAnalytics = (
  caller: Caller,
  events: ReadonlyArray<AnalyticsEvent>,
): T.Task<void, Invalid | RateLimited, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const problems = events.map(checkAnalyticsEvent).filter((problem) => problem !== null)
    if (problems.length > 0) return yield* T.fail(Invalid({ message: problems.join('; ') }))
    const allowed = events.map(() =>
      env.rateLimiter.allow(`analytics:${caller.credential.id}`, LIMITS.analytics),
    )
    if (allowed.includes(false))
      return yield* T.fail(RateLimited({ message: 'Too many analytics events in a short time.' }))
    const key = yield* analyticsKey
    env.analytics.accept(events.map((event) => ({ ...event, anonymousId: rekeyed(key, event.anonymousId) })))
  })

export const prepareAnalyticsKey: T.Task<void, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  const target = yield* dialect
  yield* run(
    insertIgnoringConflict(target, 'settings', {
      name: KEY_ROW,
      value: JSON.stringify({ key: env.random.secret() }),
    }),
  )
})

const rekeyed = (key: string, anonymousId: string): string =>
  createHmac('sha256', key).update(anonymousId).digest('hex').slice(0, 32)

const KEY_ROW = 'analytics-key'

const storedKey: T.Task<string | null, never, HasSql> = T.suspend(() =>
  T.map((row: { value: string } | null) => {
    const stored = row === null ? null : (JSON.parse(row.value) as { key?: unknown })
    return typeof stored?.key === 'string' ? stored.key : null
  })(first<{ value: string }>(sql`SELECT value FROM settings WHERE name = ${KEY_ROW}`)),
)

const analyticsKey: T.Task<string, never, AppEnv> = T.gen(function* () {
  const kept = yield* storedKey
  if (kept !== null) return kept
  yield* prepareAnalyticsKey
  const made = yield* storedKey
  return made ?? (yield* T.die(new Error('the analytics key could not be stored')))
})
