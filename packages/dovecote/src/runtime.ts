import { type Clock, Task as T, systemClock } from '@homingbird/kernel'
import { makeAnalyticsForwarder } from './analytics/forward.ts'
import { makeClientMetadataDocuments } from './auth/client-metadata.ts'
import { type Fetch, developmentProvider, openIdConnectProvider } from './auth/identity-provider.ts'
import { isLoopbackHost } from './auth/redirect-policy.ts'
import { deleteExpiredAuthRequests } from './auth/requests.ts'
import { survivingPass } from './background-pass.ts'
import type { Config } from './config.ts'
import { auditRetention } from './domain/audit-retention.ts'
import { auditHead, purgeAuditBefore } from './domain/audit.ts'
import { makeTurnHolds } from './domain/debate-turn-holds.ts'
import { settleDebate, undecidedDebates } from './domain/debate-turns.ts'
import { flushAttempts, makeAttemptWindows } from './domain/denied-attempts.ts'
import { purgeExpiredNotes } from './domain/note-retention.ts'
import { deleteSpentRefreshTokens } from './domain/refresh-tokens.ts'
import { featureIsOn } from './domain/settings.ts'
import type { AppEnv } from './environment.ts'
import { deleteEventsBefore, transact } from './events/events.ts'
import { PRESENCE_FLUSH_INTERVAL_MS, makeHub } from './events/hub.ts'
import { makeRateLimiter } from './http/rate-limiter.ts'
import { makeLog, writeToStandardOutput } from './log/operational-log.ts'
import { makePushNotifier, sendDeskUnavailablePush, sendTestPush } from './push/notifier.ts'
import { cryptoRandom } from './random.ts'
import { slackIntakePass } from './slack/slack-intake.ts'
import { slackOutboxPass } from './slack/slack-outbox.ts'
import { makeSlackApi } from './slack/slack-web-api.ts'
import { checkSlackWorkspace } from './slack/slack-workspace.ts'
import { type Database, sqlEnvironment } from './sql/database.ts'
import { SERVER_VERSION } from './version.ts'
import { makeDeskWaker } from './wake/waker.ts'

export interface Runtime {
  readonly env: AppEnv
  readonly background: T.Task<never, never, AppEnv>
  readonly settled: T.Task<void>
  /** One cloud desk wake pass, as `background` runs it every 15 seconds. */
  readonly wakePass: T.Task<void, never, AppEnv>
  /** One pass over the events Slack sent, as `background` runs it every few seconds. */
  readonly slackPass: T.Task<void, never, AppEnv>
}

export interface RuntimeParts {
  readonly config: Config
  readonly database: Database
  readonly clock?: Clock
  readonly fetch?: Fetch
  /** Where operational lines go; stdout unless a test collects them. */
  readonly write?: (line: string) => void
}

export const buildRuntime = (parts: RuntimeParts): Runtime => {
  const clock = parts.clock ?? systemClock
  const fetch = parts.fetch ?? globalThis.fetch
  const write = parts.write ?? writeToStandardOutput
  const log = makeLog({
    level: parts.config.logs.operational,
    write,
    now: clock.now,
    version: SERVER_VERSION,
  })
  const push = makePushNotifier(fetch)
  const waker = makeDeskWaker(fetch)
  const analytics = makeAnalyticsForwarder(parts.config.analytics, fetch, log)
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
    attempts: makeAttemptWindows(clock.now),
    turnHolds: makeTurnHolds(clock.now),
    analytics,
    pushSink: push.consider,
    pushTest: (memberId) => sendTestPush(fetch, memberId),
    pushDeskUnavailable: (memberId, kind) => T.asUnit(sendDeskUnavailablePush(fetch, memberId, kind)),
    wakeSink: waker.consider,
    wakeTest: waker.test,
    slackApi: (botToken) => makeSlackApi(fetch, botToken),
    log,
    requestId: null,
    client: null,
  }
  return {
    env,
    background: T.race([
      housekeeping,
      debateDeadlines,
      presenceBroadcast,
      refusedAttempts,
      analytics.run,
      chainHead,
      push.run,
      waker.run,
      slackWorkspaceChecks,
      slackIntake,
    ]),
    wakePass: waker.pass,
    slackPass: T.flatMap(() => slackOutboxPass)(slackIntakePass),
    settled: T.gen(function* () {
      yield* push.settled
      yield* analytics.settled
    }),
  }
}

export const housekeepingPass: T.Task<void, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  const now = env.clock.now()
  yield* deleteExpiredAuthRequests(now)
  yield* deleteSpentRefreshTokens(now)
  yield* deleteEventsBefore(now - EVENT_RETENTION_MS)
  const retention = yield* auditRetention
  if (retention !== 'forever') yield* transact(purgeAuditBefore(now - retention * DAY_MS))
  yield* purgeExpiredNotes
})

const housekeeping: T.Task<never, never, AppEnv> = T.forever(60 * 60_000)(
  survivingPass('housekeeping', housekeepingPass),
)

/**
 * A room whose time ran out stops within a minute, even if nobody looks at it, while debate rooms are on.
 * Each room moves on in a transaction of its own, so one room that fails leaves the others to move on.
 */
export const debateDeadlinePass: T.Task<void, never, AppEnv> = T.gen(function* () {
  if (!(yield* featureIsOn('debateRooms'))) return
  for (const id of yield* undecidedDebates())
    yield* survivingPass(`debate room ${id}`, transact(settleDebate(id)))
})

/** Refused attempts are written within ten seconds of their minute ending, one row per window. */
export const refusedAttempts: T.Task<never, never, AppEnv> = T.forever(10_000)(
  survivingPass('refused attempts', flushAttempts('due')),
)

/** Once a day the chain head goes to the operational log, so a copy of it lives outside the database. */
export const chainHeadPass: T.Task<void, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  env.log.emit({ name: 'audit.chain_head', attributes: yield* auditHead })
})

const DAY_MS = 24 * 60 * 60_000
const EVENT_RETENTION_MS = 7 * DAY_MS

const debateDeadlines: T.Task<never, never, AppEnv> = T.forever(60_000)(
  survivingPass('debate deadlines', debateDeadlinePass),
)

const presenceBroadcast: T.Task<never, never, AppEnv> = T.forever(PRESENCE_FLUSH_INTERVAL_MS)(
  survivingPass('presence', T.map((env: AppEnv) => env.hub.flushPresence())(T.ask<AppEnv>())),
)

const slackWorkspaceChecks: T.Task<never, never, AppEnv> = T.forever(60 * 60_000)(
  survivingPass('slack workspace', checkSlackWorkspace),
)

const slackIntake: T.Task<never, never, AppEnv> = T.forever(3000)(
  T.flatMap(() => survivingPass('slack outbox', slackOutboxPass))(
    survivingPass('slack intake', slackIntakePass),
  ),
)

const chainHead: T.Task<never, never, AppEnv> = T.forever(24 * 60 * 60_000)(
  survivingPass('audit chain head', chainHeadPass),
)
