import { Task as T } from '@homingbird/kernel'
import { type AnsweringFlowSetting, Invalid, Settings, answeringFlowFrom } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'

export const readSettings: T.Task<Settings, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  const row = yield* first<{ value: string }>(sql`SELECT value FROM settings WHERE name = ${SETTINGS_ROW}`)
  const decoded = row === null ? null : Settings.decode(JSON.parse(row.value))
  const organization = decoded?._tag === 'Ok' ? decoded.value : (env.config.initial as Settings)
  const { flow } = yield* readAnsweringFlow
  return { ...withoutFlow(organization), answeringFlow: flow }
})

export const writeSettings = (settings: Settings): T.Task<Settings, Invalid, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (settings.answeringFlow !== undefined) {
      const flow = settings.answeringFlow?.trim() || null
      const checked = flow === null ? null : answeringFlowFrom(flow)
      if (checked?._tag === 'Err') return yield* T.fail(Invalid({ message: checked.error }))
      if (flow !== (yield* readAnsweringFlow).flow)
        yield* store(FLOW_ROW, { flow, updatedAt: env.clock.now() })
    }
    yield* store(SETTINGS_ROW, withoutFlow(settings))
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
