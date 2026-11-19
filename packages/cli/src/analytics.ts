import { Schema as S, Task as T } from '@homingbird/kernel'
import {
  ANALYTICS_AGENT_PRESETS,
  type AnalyticsAgentPreset,
  type AnalyticsEventName,
  type AnalyticsProperties,
  type Api,
  analyticsEvent,
  isFeatureOffered,
} from '@homingbird/protocol'
import { AGENT_PRESETS } from './agent-presets.ts'
import { credentialDirectory } from './credentials.ts'
import type { CliEnv } from './environment.ts'

/**
 * Counts one product event, anonymously, and sends it to the signed-in Dovecote only, when that server
 * offers analytics. The first time, it says so once. `DO_NOT_TRACK=1` or `homingbird analytics off`
 * stops it. Never fails the command it counts.
 */
export const countUsage = <N extends AnalyticsEventName>(
  api: Api,
  name: N,
  properties: AnalyticsProperties<N>,
): T.Task<void, never, AnalyticsEnv> =>
  T.catchAll(() => T.unit)(
    T.gen(function* () {
      const env = yield* T.ask<AnalyticsEnv>()
      if (isDoNotTrack(env.variables)) return
      const settings = yield* readAnalyticsSettings
      if (!settings.enabled) return
      const info = yield* api['server.info']({})
      if (!isFeatureOffered(info, 'analytics')) return
      const anonymousId = settings.anonymousId || env.nonce()
      if (!settings.noticeShown) {
        const kept = yield* writeAnalyticsSettings({ ...settings, anonymousId, noticeShown: true })
        if (!kept) return
        env.output.problem(ANALYTICS_NOTICE)
      }
      yield* api['analytics.track']({
        body: { events: [analyticsEvent(name, properties, anonymousId, env.clock.now())] },
      })
    }),
  )

/** `homingbird analytics on|off|status`: the person's own choice, kept on this computer. */
export const setAnalytics = (
  action: 'on' | 'off' | 'status',
): T.Task<{ readonly enabled: boolean; readonly doNotTrack: boolean }, never, AnalyticsEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AnalyticsEnv>()
    const settings = yield* readAnalyticsSettings
    const wanted = action === 'status' ? settings.enabled : action === 'on'
    const kept =
      action === 'status' ||
      (yield* writeAnalyticsSettings({
        anonymousId: settings.anonymousId || env.nonce(),
        enabled: wanted,
        noticeShown: true,
      }))
    return { enabled: wanted && kept, doNotTrack: isDoNotTrack(env.variables) }
  })

export const ANALYTICS_NOTICE =
  'This Homingbird server counts anonymous usage, such as which agent preset a desk runs, never notes, names or email addresses. Turn it off with `homingbird analytics off` or DO_NOT_TRACK=1.'

export const isDoNotTrack = (variables: Readonly<Record<string, string | undefined>>): boolean =>
  variables.DO_NOT_TRACK !== undefined && variables.DO_NOT_TRACK !== '' && variables.DO_NOT_TRACK !== '0'

/** The preset a desk runs, by name, or `custom`: never the command itself, which can hold paths. */
export const presetLabel = (agent: string): AnalyticsAgentPreset => {
  const name = AGENT_PRESETS.find((preset) => preset.agent === agent || preset.name === agent)?.name
  return ANALYTICS_AGENT_PRESETS.find((known) => known === name) ?? 'custom'
}

const AnalyticsSettings = S.struct({
  anonymousId: S.string({ pattern: /^[A-Za-z0-9_-]{8,64}$/ }),
  enabled: S.boolean,
  noticeShown: S.boolean,
})
type AnalyticsSettings = S.Infer<typeof AnalyticsSettings>

export type AnalyticsEnv = Pick<
  CliEnv,
  'clock' | 'files' | 'output' | 'variables' | 'homeDirectory' | 'nonce'
>

const settingsPath = (env: AnalyticsEnv): string => `${credentialDirectory(env)}/analytics.json`

/**
 * The kept settings; fresh ones, without an id yet, when there is no file; off when the file cannot be
 * read, so a broken file never sends anything.
 */
const readAnalyticsSettings: T.Task<AnalyticsSettings, never, AnalyticsEnv> = T.gen(function* () {
  const env = yield* T.ask<AnalyticsEnv>()
  const content = yield* T.exit(env.files.read(settingsPath(env)))
  if (content._tag === 'Err') return { anonymousId: '', enabled: false, noticeShown: true }
  if (content.value === null) return { anonymousId: '', enabled: true, noticeShown: false }
  const decoded = AnalyticsSettings.decode(parsed(content.value))
  return decoded._tag === 'Ok' ? decoded.value : { anonymousId: '', enabled: false, noticeShown: true }
})

/** Whether the settings were kept; a file that cannot be written leaves counting off. */
const writeAnalyticsSettings = (settings: AnalyticsSettings): T.Task<boolean, never, AnalyticsEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AnalyticsEnv>()
    const written = yield* T.exit(
      env.files.writePrivate(settingsPath(env), `${JSON.stringify(settings, null, 2)}\n`),
    )
    return written._tag === 'Ok'
  })

const parsed = (content: string): unknown => {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}
