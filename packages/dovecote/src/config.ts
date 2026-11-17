import { Result, Schema as S } from '@homingbird/kernel'
import type { ContactMode } from '@homingbird/protocol'

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
  }
  readonly adminEmails: ReadonlyArray<string>
  readonly sessionDays: number
  readonly audit: { readonly toStdout: boolean; readonly webhookUrl: string | null }
  readonly agentCredentialDays: number
}

export const loadConfig = (
  environment: Readonly<Record<string, string | undefined>>,
): Result.Result<Config, ReadonlyArray<string>> => {
  const decoded = Variables.decode(withoutBlanks(environment))
  if (decoded._tag === 'Err') return Result.err(decoded.error.map((issue) => `${issue.path.join('.')}: ${issue.message}`))
  const v = decoded.value
  const devLogin = v.HB_DEV_LOGIN === '1'
  const problems = [
    !devLogin && !v.HB_OIDC_CLIENT_ID ? 'HB_OIDC_CLIENT_ID: is required unless HB_DEV_LOGIN=1' : null,
    !devLogin && !v.HB_OIDC_CLIENT_SECRET ? 'HB_OIDC_CLIENT_SECRET: is required unless HB_DEV_LOGIN=1' : null,
    devLogin && !isLoopback(v.HB_PUBLIC_URL) ? 'HB_DEV_LOGIN: only allowed when HB_PUBLIC_URL is a loopback address' : null,
  ].filter((problem): problem is string => problem !== null)
  if (problems.length > 0) return Result.err(problems)
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
    },
    adminEmails: commaList(v.HB_ADMIN_EMAILS),
    sessionDays: Number(v.HB_SESSION_DAYS ?? '30'),
    audit: { toStdout: v.HB_AUDIT_STDOUT === '1', webhookUrl: v.HB_AUDIT_WEBHOOK_URL ?? null },
    agentCredentialDays: Number(v.HB_AGENT_CREDENTIAL_DAYS ?? '90'),
  })
}

const positiveInteger = S.string({ pattern: /^[1-9][0-9]{0,5}$/ })

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
  HB_CONTACT_MODE: S.optional(S.literal('open', 'contacts')),
  HB_AUDIT_RETENTION_DAYS: S.optional(positiveInteger),
  HB_SESSION_DAYS: S.optional(positiveInteger),
  HB_AUDIT_STDOUT: S.optional(S.literal('0', '1')),
  HB_AUDIT_WEBHOOK_URL: S.optional(S.string({ pattern: /^https?:\/\// })),
  HB_AGENT_CREDENTIAL_DAYS: S.optional(positiveInteger),
})

const withoutBlanks = (environment: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => (entry[1] ?? '') !== ''))

const commaList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '')

const isLoopback = (url: string): boolean => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url)
