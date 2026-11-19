import { Task as T } from '@homingbird/kernel'
import type { Config } from '../config.ts'
import type { AppEnv } from '../environment.ts'
import { savedAuditRetention } from './settings.ts'

/** An upgrade never shortens, unasked, a longer retention an administrator saved before the variable. */
export const auditRetention: T.Task<Retention, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  return retentionFrom(env.config, yield* savedAuditRetention)
})

/** Days audit rows are kept, or `forever` when an administrator chose to keep them and nothing overrides it. */
export type Retention = number | 'forever'

export const retentionFrom = (
  config: Pick<Config, 'auditRetentionDays' | 'auditRetentionVariableDays'>,
  saved: Retention | null,
): Retention => {
  if (config.auditRetentionVariableDays !== null || saved === null) return config.auditRetentionDays
  return isShorter(config.auditRetentionDays, saved) ? saved : config.auditRetentionDays
}

export const auditRetentionWarnings: T.Task<ReadonlyArray<RetentionWarning>, never, AppEnv> = T.gen(
  function* () {
    const env = yield* T.ask<AppEnv>()
    const saved = yield* savedAuditRetention
    const kept = retentionFrom(env.config, saved)
    const requested = env.config.auditRetentionVariableDays
    return [
      ...(requested !== null && kept !== 'forever' && requested < kept
        ? [{ kind: 'raised' as const, requested, days: kept }]
        : []),
      ...(saved !== null && kept !== 'forever' && isShorter(kept, saved)
        ? [{ kind: 'shorter' as const, saved, days: kept }]
        : []),
    ]
  },
)

export type RetentionWarning =
  | { readonly kind: 'raised'; readonly requested: number; readonly days: number }
  | { readonly kind: 'shorter'; readonly saved: Retention; readonly days: number }

const isShorter = (days: number, than: Retention): boolean => than === 'forever' || days < than
