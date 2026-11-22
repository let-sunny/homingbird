import { Task as T } from '@homingbird/kernel'
import {
  type AnsweringFlowSetting,
  FEATURE_NAMES,
  type FeatureName,
  Invalid,
  Settings,
  answeringFlowFrom,
  featureSwitches,
  isFeatureOn,
} from '@homingbird/protocol'
import type { Config } from '../config.ts'
import type { AppEnv } from '../environment.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'

export const readSettings: T.Task<Settings, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  const row = yield* first<{ value: string }>(sql`SELECT value FROM settings WHERE name = ${SETTINGS_ROW}`)
  const decoded = row === null ? null : Settings.decode(JSON.parse(row.value))
  const { auditRetentionDays: _, ...organization } =
    decoded?._tag === 'Ok' ? decoded.value : (env.config.initial as Settings)
  const { flow } = yield* readAnsweringFlow
  return {
    ...withoutFlow(organization),
    answeringFlow: flow,
    features: featureSwitches(organization.features ?? env.config.initial.features),
    whoCanInvite: organization.whoCanInvite === 'members' ? 'members' : 'admins',
  }
})

export const writeSettings = (settings: Settings): T.Task<Settings, Invalid, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const unknown = Object.keys(settings.features ?? {}).filter(
      (name) => !FEATURE_NAMES.includes(name as FeatureName),
    )
    if (unknown.length > 0)
      return yield* T.fail(Invalid({ message: `There is no feature named ${unknown.join(', ')}.` }))
    if (settings.answeringFlow !== undefined) {
      const flow = settings.answeringFlow?.trim() || null
      const checked = flow === null ? null : answeringFlowFrom(flow)
      if (checked?._tag === 'Err') return yield* T.fail(Invalid({ message: checked.error }))
      if (flow !== (yield* readAnsweringFlow).flow)
        yield* store(FLOW_ROW, { flow, updatedAt: env.clock.now() })
    }
    const current = yield* readSettings
    const savedRetention = yield* savedAuditRetention
    const { auditRetentionDays: _, ...kept } = withoutFlow(settings)
    yield* store(SETTINGS_ROW, {
      ...kept,
      whoCanInvite: settings.whoCanInvite ?? current.whoCanInvite,
      features: featureSwitches({ ...current.features, ...settings.features }),
      ...(savedRetention !== null && {
        auditRetentionDays: savedRetention === 'forever' ? null : savedRetention,
      }),
    })
    return yield* readSettings
  })

export const readAnsweringFlow: T.Task<AnsweringFlowSetting, never, AppEnv> = T.gen(function* () {
  const row = yield* first<{ value: string }>(sql`SELECT value FROM settings WHERE name = ${FLOW_ROW}`)
  const stored = row === null ? null : (JSON.parse(row.value) as Partial<AnsweringFlowSetting>)
  return {
    flow: typeof stored?.flow === 'string' ? stored.flow : null,
    updatedAt: typeof stored?.updatedAt === 'number' ? stored.updatedAt : null,
  }
})

/**
 * The audit retention an administrator saved before the operator's variable replaced it: days, or
 * `forever` for the saved null that meant keep every row; null when none was saved. Saving the
 * settings again keeps it, so housekeeping can still honour it.
 */
export const savedAuditRetention: T.Task<number | 'forever' | null, never, AppEnv> = T.suspend(() =>
  T.map((row: { value: string } | null) => {
    const saved = row === null ? {} : (JSON.parse(row.value) as { auditRetentionDays?: unknown })
    if (typeof saved.auditRetentionDays === 'number') return saved.auditRetentionDays
    return saved.auditRetentionDays === null ? 'forever' : null
  })(first<{ value: string }>(sql`SELECT value FROM settings WHERE name = ${SETTINGS_ROW}`)),
)

/** Whether an optional feature is on in this organization; analytics also need a destination. */
export const featureIsOn = (name: FeatureName): T.Task<boolean, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    return offeredFeatures(yield* readSettings, env.config)[name]
  })

/** The switches, but analytics needs a destination, the cloud desk a key, Slack its app or a key. */
export const offeredFeatures = (settings: Settings, config: Config): Record<FeatureName, boolean> => {
  const switches = featureSwitches(settings.features)
  return {
    ...switches,
    analytics: switches.analytics && config.analytics.kind !== 'off',
    cloudDesk: switches.cloudDesk && config.secretsKey !== null,
    slack: switches.slack && (config.slack !== null || config.secretsKey !== null),
  }
}

export const isAllowedEmail = (settings: Settings, email: string): boolean => {
  const domain = email.toLowerCase().split('@').at(-1) ?? ''
  return settings.allowedDomains.includes(domain)
}

const SETTINGS_ROW = 'organization'
const FLOW_ROW = 'answering-flow'

const withoutFlow = ({ answeringFlow: _, ...rest }: Settings): Omit<Settings, 'answeringFlow'> => rest

const store = (name: string, value: unknown): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    yield* run(sql`DELETE FROM settings WHERE name = ${name}`)
    yield* run(insertInto('settings', { name, value: JSON.stringify(value) }))
  })
