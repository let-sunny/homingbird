import { Task as T } from '@homingbird/kernel'
import { Settings } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'

export const readSettings: T.Task<Settings, never, AppEnv> = T.gen(function* () {
  const env = yield* T.ask<AppEnv>()
  const row = yield* first<{ value: string }>(sql`SELECT value FROM settings WHERE name = ${SETTINGS_ROW}`)
  if (row === null) return env.config.initial as Settings
  const decoded = Settings.decode(JSON.parse(row.value))
  return decoded._tag === 'Ok' ? decoded.value : (env.config.initial as Settings)
})

export const writeSettings = (settings: Settings): T.Task<Settings, never, AppEnv> =>
  T.gen(function* () {
    yield* run(sql`DELETE FROM settings WHERE name = ${SETTINGS_ROW}`)
    yield* run(insertInto('settings', { name: SETTINGS_ROW, value: JSON.stringify(settings) }))
    return settings
  })

export const isAllowedEmail = (settings: Settings, email: string): boolean => {
  const domain = email.toLowerCase().split('@').at(-1) ?? ''
  return settings.allowedDomains.includes(domain)
}

const SETTINGS_ROW = 'organization'
