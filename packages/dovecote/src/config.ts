import { Result, Schema as S } from '@homingbird/kernel'
import { type ContactMode, featureSwitchesFrom } from '@homingbird/protocol'
import { isFetchableHostName } from './auth/client-metadata.ts'
import { parseConfiguredClients } from './auth/configured-clients.ts'
import { DEFAULT_CLIENT_METADATA_HOSTS, DEFAULT_REDIRECT_HOSTS } from './auth/default-oauth-hosts.ts'
import type { RegisteredClient } from './auth/oauth.ts'
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
    readonly auditRetentionDays: number | null
    readonly features: Readonly<Record<string, boolean>>
  }
  readonly adminEmails: ReadonlyArray<string>
  readonly channels: ReadonlyArray<{ readonly slug: string; readonly description: string }>
  readonly trustedProxies: number
  readonly pushHosts: ReadonlyArray<string>
  readonly sessionDays: number
  readonly audit: { readonly toStdout: boolean; readonly webhookUrl: string | null }
  readonly agentCredentialDays: number
  readonly insights: { readonly quickApprovalSeconds: number; readonly minimumGroupSize: number }
  readonly oauth: {
    readonly redirectHosts: ReadonlyArray<string>
    readonly clientMetadataHosts: ReadonlyArray<string>
    readonly clients: ReadonlyArray<RegisteredClient>
  }
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
    v.HB_INSIGHTS_MINIMUM_GROUP !== undefined && Number(v.HB_INSIGHTS_MINIMUM_GROUP) < SMALLEST_GROUP_SHOWN
      ? `HB_INSIGHTS_MINIMUM_GROUP: must be at least ${SMALLEST_GROUP_SHOWN}; smaller groups would show one person's figures`
      : null,
    ...features.unknown.map(
      (item) => `HB_FEATURES: "${item}" is not a feature switch; write name=on or name=off with a known name`,
    ),
    ...(clients._tag === 'Err' ? clients.error : []),
  ].filter((problem): problem is string => problem !== null)
  if (problems.length > 0 || clients._tag === 'Err') return Result.err(problems)
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
      auditRetentionDays: v.HB_AUDIT_RETENTION_DAYS ? Number(v.HB_AUDIT_RETENTION_DAYS) : null,
      features: features.switches,
    },
    adminEmails: commaList(v.HB_ADMIN_EMAILS),
    channels: seedChannelsOf(v.HB_CHANNELS),
    trustedProxies: Number(v.HB_TRUST_PROXY ?? '0'),
    pushHosts: v.HB_PUSH_HOSTS ? commaList(v.HB_PUSH_HOSTS) : DEFAULT_PUSH_HOSTS,
    sessionDays: Number(v.HB_SESSION_DAYS ?? '30'),
    audit: { toStdout: v.HB_AUDIT_STDOUT === '1', webhookUrl: v.HB_AUDIT_WEBHOOK_URL ?? null },
    agentCredentialDays: Number(v.HB_AGENT_CREDENTIAL_DAYS ?? '90'),
    insights: {
      quickApprovalSeconds: Number(v.HB_QUICK_APPROVAL_SECONDS ?? '3'),
      minimumGroupSize: Number(v.HB_INSIGHTS_MINIMUM_GROUP ?? String(SMALLEST_GROUP_SHOWN)),
    },
    oauth: { redirectHosts, clientMetadataHosts, clients: clients.value },
  })
}

const CHANNEL_LIST =
  /^\s*[a-z0-9][a-z0-9-]{0,39}(:[^,]{0,200})?(\s*,\s*[a-z0-9][a-z0-9-]{0,39}(:[^,]{0,200})?)*\s*$/

const positiveInteger = S.string({ pattern: /^[1-9][0-9]{0,5}$/ })

const SMALLEST_GROUP_SHOWN = 5

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
  HB_SESSION_DAYS: S.optional(positiveInteger),
  HB_AUDIT_STDOUT: S.optional(S.literal('0', '1')),
  HB_AUDIT_WEBHOOK_URL: S.optional(S.string({ pattern: /^https?:\/\// })),
  HB_AGENT_CREDENTIAL_DAYS: S.optional(positiveInteger),
  HB_QUICK_APPROVAL_SECONDS: S.optional(S.string({ pattern: /^[1-9][0-9]?$/ })),
  HB_INSIGHTS_MINIMUM_GROUP: S.optional(S.string({ pattern: /^[1-9][0-9]{0,3}$/ })),
  HB_OAUTH_REDIRECT_HOSTS: S.optional(S.string()),
  HB_OAUTH_CLIENT_METADATA_HOSTS: S.optional(S.string()),
  HB_OAUTH_CLIENTS: S.optional(S.string()),
  HB_FEATURES: S.optional(S.string()),
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

const isLoopback = (url: string): boolean =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url)
