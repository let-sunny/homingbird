import { Result, Schema as S } from '@homingbird/kernel'
import { type ContactMode, featureSwitchesFrom } from '@homingbird/protocol'
import { isFetchableHostName } from './auth/client-metadata.ts'
import { parseConfiguredClients } from './auth/configured-clients.ts'
import { DEFAULT_CLIENT_METADATA_HOSTS, DEFAULT_REDIRECT_HOSTS } from './auth/default-oauth-hosts.ts'
import type { RegisteredClient } from './auth/oauth-clients.ts'
import { type LogSettings, logSettingsFrom } from './log/log-settings.ts'
import { DEFAULT_PUSH_HOSTS } from './push/default-hosts.ts'

export interface Config {
  readonly publicUrl: string
  readonly port: number
  readonly databaseUrl: string
  readonly webDirectory: string | null
  readonly themeDirectory: string | null
  readonly identity: {
    readonly issuer: string
    readonly clientId: string
    readonly clientSecret: string
    readonly label: string
    readonly devLogin: boolean
  }
  readonly initial: {
    readonly allowedDomains: ReadonlyArray<string>
    readonly contactMode: ContactMode
    readonly features: Readonly<Record<string, boolean>>
  }
  readonly adminEmails: ReadonlyArray<string>
  readonly channels: ReadonlyArray<{ readonly slug: string; readonly description: string }>
  readonly trustedProxies: number
  readonly pushHosts: ReadonlyArray<string>
  readonly sessionDays: number
  readonly logs: LogSettings
  /** Days audit rows are kept unless an administrator saved longer before the variable replaced it. */
  readonly auditRetentionDays: number
  /** What HB_AUDIT_RETENTION_DAYS asked for, even below the minimum; null when it is unset. */
  readonly auditRetentionVariableDays: number | null
  /** Days sent and discarded notes are kept before housekeeping deletes them; null keeps them. */
  readonly noteRetentionDays: number | null
  readonly ignoredVariables: ReadonlyArray<'HB_AUDIT_WEBHOOK_URL'>
  readonly analytics: AnalyticsDestination
  readonly agentCredentialDays: number
  readonly insights: { readonly quickApprovalSeconds: number; readonly minimumGroupSize: number }
  readonly oauth: {
    readonly redirectHosts: ReadonlyArray<string>
    readonly clientMetadataHosts: ReadonlyArray<string>
    readonly clients: ReadonlyArray<RegisteredClient>
  }
  /** The key that seals cloud desk wakes; the cloud desk is offered only with one. Never logged or shown. */
  readonly secretsKey: Buffer | null
  /** The hosts a cloud desk's wake may call, each matched exactly. */
  readonly wakeHosts: ReadonlyArray<string>
}

export const loadConfig = (
  environment: Readonly<Record<string, string | undefined>>,
): Result.Result<Config, ReadonlyArray<string>> => {
  const decoded = Variables.decode(withoutBlanks(environment))
  if (decoded._tag === 'Err')
    return Result.err(decoded.error.map((issue) => `${issue.path.join('.')}: ${issue.message}`))
  const v = decoded.value
  const devLogin = v.HB_DEV_LOGIN === '1'
  const redirectHosts = hostListOf(v.HB_OAUTH_REDIRECT_HOSTS, DEFAULT_REDIRECT_HOSTS)
  const clientMetadataHosts = hostListOf(v.HB_OAUTH_CLIENT_METADATA_HOSTS, DEFAULT_CLIENT_METADATA_HOSTS)
  const clients = parseConfiguredClients(v.HB_OAUTH_CLIENTS)
  const features = featureSwitchesFrom(v.HB_FEATURES ?? '')
  const wakeHosts = hostListOf(v.HB_WAKE_HOSTS, DEFAULT_WAKE_HOSTS)
  const secretsKey = v.HB_SECRETS_KEY === undefined ? null : secretsKeyOf(v.HB_SECRETS_KEY)
  const logs = logSettingsFrom(v.HB_LOGS ?? '', v.HB_AUDIT_STDOUT === '1')
  const analytics = analyticsDestinationOf(v.HB_ANALYTICS ?? 'off', v.HB_ANALYTICS_URL, v.HB_ANALYTICS_KEY)
  const problems = [
    environment.HB_TOPICS !== undefined
      ? 'HB_TOPICS: was renamed to HB_CHANNELS; set HB_CHANNELS instead and remove HB_TOPICS'
      : null,
    !devLogin && !v.HB_OIDC_CLIENT_ID ? 'HB_OIDC_CLIENT_ID: is required unless HB_DEV_LOGIN=1' : null,
    !devLogin && !v.HB_OIDC_CLIENT_SECRET ? 'HB_OIDC_CLIENT_SECRET: is required unless HB_DEV_LOGIN=1' : null,
    !devLogin && commaList(v.HB_ADMIN_EMAILS).length === 0
      ? 'HB_ADMIN_EMAILS: name at least one administrator; nobody becomes one implicitly'
      : null,
    devLogin && !isLoopback(v.HB_PUBLIC_URL)
      ? 'HB_DEV_LOGIN: only allowed when HB_PUBLIC_URL is a loopback address'
      : null,
    ...redirectHosts
      .filter((host) => !HOST_NAME.test(host))
      .map((host) => `HB_OAUTH_REDIRECT_HOSTS: "${host}" is not a host name`),
    ...clientMetadataHosts
      .filter((host) => !isFetchableHostName(host))
      .map(
        (host) =>
          `HB_OAUTH_CLIENT_METADATA_HOSTS: "${host}" must be a public host name, not an address or loopback`,
      ),
    v.HB_NOTE_RETENTION_DAYS !== undefined && Number(v.HB_NOTE_RETENTION_DAYS) < NOTE_RETENTION_MINIMUM_DAYS
      ? `HB_NOTE_RETENTION_DAYS: must be at least ${NOTE_RETENTION_MINIMUM_DAYS}, or unset to keep notes`
      : null,
    secretsKey === 'malformed'
      ? 'HB_SECRETS_KEY: must be 32 random bytes in base64, such as the output of `openssl rand -base64 32`'
      : null,
    ...wakeHosts
      .filter((host) => !isFetchableHostName(host))
      .map((host) => `HB_WAKE_HOSTS: "${host}" must be a public host name, not an address or loopback`),
    ...features.unknown.map(
      (item) => `HB_FEATURES: "${item}" is not a feature switch; write name=on or name=off with a known name`,
    ),
    ...(clients._tag === 'Err' ? clients.error : []),
    ...logs.problems,
    ...(typeof analytics === 'string' ? [analytics] : []),
  ].filter((problem): problem is string => problem !== null)
  if (
    problems.length > 0 ||
    clients._tag === 'Err' ||
    typeof analytics === 'string' ||
    secretsKey === 'malformed'
  )
    return Result.err(problems)
  return Result.ok({
    publicUrl: v.HB_PUBLIC_URL.replace(/\/+$/, ''),
    port: Number(v.HB_PORT ?? '8080'),
    databaseUrl: v.HB_DATABASE_URL ?? 'sqlite:./data/dovecote.sqlite',
    webDirectory: v.HB_WEB_DIR ?? null,
    themeDirectory: v.HB_THEME_DIR ?? null,
    identity: {
      issuer: (v.HB_OIDC_ISSUER ?? 'https://accounts.google.com').replace(/\/+$/, ''),
      clientId: v.HB_OIDC_CLIENT_ID ?? '',
      clientSecret: v.HB_OIDC_CLIENT_SECRET ?? '',
      label: v.HB_OIDC_LABEL ?? (devLogin ? 'development login' : 'Google'),
      devLogin,
    },
    initial: {
      allowedDomains: commaList(v.HB_ALLOWED_DOMAINS),
      contactMode: v.HB_CONTACT_MODE ?? 'open',
      features: features.switches,
    },
    adminEmails: commaList(v.HB_ADMIN_EMAILS),
    channels: seedChannelsOf(v.HB_CHANNELS),
    trustedProxies: Number(v.HB_TRUST_PROXY ?? '0'),
    pushHosts: v.HB_PUSH_HOSTS ? commaList(v.HB_PUSH_HOSTS) : DEFAULT_PUSH_HOSTS,
    sessionDays: Number(v.HB_SESSION_DAYS ?? '30'),
    logs: logs.settings,
    auditRetentionDays:
      v.HB_AUDIT_RETENTION_DAYS === undefined
        ? AUDIT_RETENTION_DEFAULT_DAYS
        : Math.max(Number(v.HB_AUDIT_RETENTION_DAYS), AUDIT_RETENTION_MINIMUM_DAYS),
    auditRetentionVariableDays:
      v.HB_AUDIT_RETENTION_DAYS === undefined ? null : Number(v.HB_AUDIT_RETENTION_DAYS),
    noteRetentionDays: v.HB_NOTE_RETENTION_DAYS === undefined ? null : Number(v.HB_NOTE_RETENTION_DAYS),
    ignoredVariables: v.HB_AUDIT_WEBHOOK_URL === undefined ? [] : ['HB_AUDIT_WEBHOOK_URL'],
    analytics,
    agentCredentialDays: Number(v.HB_AGENT_CREDENTIAL_DAYS ?? '90'),
    insights: {
      quickApprovalSeconds: Number(v.HB_QUICK_APPROVAL_SECONDS ?? '3'),
      minimumGroupSize: Number(v.HB_INSIGHTS_MINIMUM_GROUP ?? String(DEFAULT_MINIMUM_GROUP)),
    },
    oauth: { redirectHosts, clientMetadataHosts, clients: clients.value },
    secretsKey,
    wakeHosts,
  })
}

const AUDIT_RETENTION_DEFAULT_DAYS = 400
const AUDIT_RETENTION_MINIMUM_DAYS = 90

/** A week, the event backlog's own retention, so no event outlives the note it carries. */
const NOTE_RETENTION_MINIMUM_DAYS = 7

/** Where product analytics go, if anywhere. The key is a secret: it is never logged or shown. */
export type AnalyticsDestination =
  | { readonly kind: 'off' }
  | { readonly kind: 'posthog' | 'ga4' | 'http'; readonly url: string; readonly key: string | null }

const CHANNEL_LIST =
  /^\s*[a-z0-9][a-z0-9-]{0,39}(:[^,]{0,200})?(\s*,\s*[a-z0-9][a-z0-9-]{0,39}(:[^,]{0,200})?)*\s*$/

const positiveInteger = S.string({ pattern: /^[1-9][0-9]{0,5}$/ })

const DEFAULT_MINIMUM_GROUP = 1

const Variables = S.struct({
  HB_PUBLIC_URL: S.string({ pattern: /^https?:\/\/[^\s/]+(\/.*)?$/ }),
  HB_PORT: S.optional(positiveInteger),
  HB_DATABASE_URL: S.optional(S.string({ pattern: /^(sqlite|postgres|postgresql|mysql):/ })),
  HB_WEB_DIR: S.optional(S.string()),
  HB_THEME_DIR: S.optional(S.string()),
  HB_OIDC_ISSUER: S.optional(S.string({ pattern: /^https?:\/\// })),
  HB_OIDC_CLIENT_ID: S.optional(S.string()),
  HB_OIDC_CLIENT_SECRET: S.optional(S.string()),
  HB_OIDC_LABEL: S.optional(S.string({ maxLength: 40 })),
  HB_DEV_LOGIN: S.optional(S.literal('0', '1')),
  HB_ALLOWED_DOMAINS: S.optional(S.string()),
  HB_ADMIN_EMAILS: S.optional(S.string()),
  HB_CHANNELS: S.optional(S.string({ pattern: CHANNEL_LIST })),
  HB_TRUST_PROXY: S.optional(S.string({ pattern: /^[0-9]$/ })),
  HB_PUSH_HOSTS: S.optional(S.string()),
  HB_CONTACT_MODE: S.optional(S.literal('open', 'contacts')),
  HB_AUDIT_RETENTION_DAYS: S.optional(positiveInteger),
  HB_NOTE_RETENTION_DAYS: S.optional(positiveInteger),
  HB_SESSION_DAYS: S.optional(positiveInteger),
  HB_AUDIT_STDOUT: S.optional(S.literal('0', '1')),
  HB_AUDIT_WEBHOOK_URL: S.optional(S.string()),
  HB_LOGS: S.optional(S.string({ maxLength: 200 })),
  HB_ANALYTICS: S.optional(S.literal('posthog', 'ga4', 'http', 'off')),
  HB_ANALYTICS_URL: S.optional(S.string({ pattern: /^https:\/\/[^\s/]+(\/\S*)?$/ })),
  HB_ANALYTICS_KEY: S.optional(S.string({ maxLength: 400 })),
  HB_AGENT_CREDENTIAL_DAYS: S.optional(positiveInteger),
  HB_QUICK_APPROVAL_SECONDS: S.optional(S.string({ pattern: /^[1-9][0-9]?$/ })),
  HB_INSIGHTS_MINIMUM_GROUP: S.optional(S.string({ pattern: /^[1-9][0-9]{0,3}$/ })),
  HB_OAUTH_REDIRECT_HOSTS: S.optional(S.string()),
  HB_OAUTH_CLIENT_METADATA_HOSTS: S.optional(S.string()),
  HB_OAUTH_CLIENTS: S.optional(S.string()),
  HB_FEATURES: S.optional(S.string()),
  HB_SECRETS_KEY: S.optional(S.string({ maxLength: 200 })),
  HB_WAKE_HOSTS: S.optional(S.string()),
})

const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

const withoutBlanks = (environment: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => (entry[1] ?? '') !== ''),
  )

const seedChannelsOf = (value: string | undefined): Config['channels'] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item) => {
      const [slug = '', ...description] = item.split(':')
      return { slug, description: description.join(':').trim() || slug }
    })

const commaList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '')

const hostListOf = (value: string | undefined, defaults: ReadonlyArray<string>): ReadonlyArray<string> =>
  value === undefined ? defaults : value.trim().toLowerCase() === 'none' ? [] : commaList(value)

const DEFAULT_WAKE_HOSTS = ['api.anthropic.com']

const secretsKeyOf = (text: string): Buffer | 'malformed' => {
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(text)) return 'malformed'
  const key = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return key.length === SECRETS_KEY_BYTES ? key : 'malformed'
}

const SECRETS_KEY_BYTES = 32

const isLoopback = (url: string): boolean =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url)

const POSTHOG_DEFAULT_URL = 'https://us.i.posthog.com'

const analyticsDestinationOf = (
  kind: 'posthog' | 'ga4' | 'http' | 'off',
  url: string | undefined,
  key: string | undefined,
): AnalyticsDestination | string => {
  if (kind === 'off') return { kind }
  if (kind === 'posthog')
    return key === undefined
      ? 'HB_ANALYTICS_KEY: PostHog needs the project API key'
      : { kind, url: (url ?? POSTHOG_DEFAULT_URL).replace(/\/+$/, ''), key }
  if (kind === 'ga4')
    return url === undefined || !/[?&]measurement_id=G-[A-Z0-9]+/.test(url) || key === undefined
      ? 'HB_ANALYTICS_URL and HB_ANALYTICS_KEY: GA4 needs the Measurement Protocol address with measurement_id=G-... and the API secret'
      : { kind, url, key }
  return url === undefined
    ? 'HB_ANALYTICS_URL: HB_ANALYTICS=http needs the address events are posted to'
    : { kind, url, key: key ?? null }
}
