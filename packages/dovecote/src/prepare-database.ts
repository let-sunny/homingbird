import { Task as T } from '@homingbird/kernel'
import { prepareAnalyticsKey } from './domain/analytics.ts'
import { prepareAuditHead, purgeLegacyAudit, recordAudit } from './domain/audit.ts'
import { seedChannels } from './domain/channels.ts'
import { savedAuditRetention } from './domain/settings.ts'
import type { AppEnv } from './environment.ts'
import { transact } from './events/events.ts'
import { AUDIT_TRAIL_STEP } from './sql/migrations.ts'
import { type UnknownDatabase, migrate } from './sql/schema.ts'

export const prepareDatabase: T.Task<void, UnknownDatabase, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  const steps = yield* migrate
  yield* prepareAuditHead
  yield* prepareAnalyticsKey
  if (steps.length > 0) {
    env.log.emit({ name: 'system.migrated', attributes: { steps: [...steps] } })
    yield* transact(recordAudit('system.migrated', { detail: { steps } }))
  }
  if (steps.includes(AUDIT_TRAIL_STEP)) {
    const days = (yield* savedAuditRetention) ?? env.config.auditRetentionDays
    if (days !== 'forever') yield* transact(purgeLegacyAudit(env.clock.now() - days * DAY_MS, 'upgrade'))
  }
  yield* seedChannels
})

const DAY_MS = 24 * 60 * 60_000
