import { describe, expect, it } from 'vitest'
import { type Config, loadConfig } from '../src/config.ts'

const PRODUCTION = {
  HB_PUBLIC_URL: 'https://homingbird.example.com/',
  HB_OIDC_CLIENT_ID: 'client',
  HB_OIDC_CLIENT_SECRET: 'secret',
  HB_ADMIN_EMAILS: 'Admin@Example.com, ops@example.com',
}

const loaded = (environment: Readonly<Record<string, string | undefined>>): Config => {
  const result = loadConfig(environment)
  if (result._tag === 'Err') throw new Error(result.error.join('; '))
  return result.value
}

const problemsOf = (environment: Readonly<Record<string, string | undefined>>): ReadonlyArray<string> => {
  const result = loadConfig(environment)
  return result._tag === 'Err' ? result.error : []
}

describe('the configuration', () => {
  it('fills every default a production server needs from four variables', () => {
    const config = loaded(PRODUCTION)
    expect(config).toMatchObject({
      publicUrl: 'https://homingbird.example.com',
      port: 8080,
      databaseUrl: 'sqlite:./data/dovecote.sqlite',
      adminEmails: ['admin@example.com', 'ops@example.com'],
      identity: { issuer: 'https://accounts.google.com', label: 'Google', devLogin: false },
      sessionDays: 30,
      agentCredentialDays: 90,
      auditRetentionDays: 400,
      analytics: { kind: 'off' },
      insights: { quickApprovalSeconds: 3, minimumGroupSize: 1 },
      trustedProxies: 0,
    })
    expect(config.oauth.redirectHosts.length).toBeGreaterThan(0)
  })

  it('reads a blank variable as unset', () => {
    expect(loaded({ ...PRODUCTION, HB_PORT: '', HB_DATABASE_URL: '' })).toMatchObject({
      port: 8080,
      databaseUrl: 'sqlite:./data/dovecote.sqlite',
    })
  })

  it('names every missing sign-in setting and administrator at once', () => {
    expect(problemsOf({ HB_PUBLIC_URL: 'https://homingbird.example.com' })).toEqual([
      'HB_OIDC_CLIENT_ID: is required unless HB_DEV_LOGIN=1',
      'HB_OIDC_CLIENT_SECRET: is required unless HB_DEV_LOGIN=1',
      'HB_ADMIN_EMAILS: name at least one administrator; nobody becomes one implicitly',
    ])
  })

  it('allows the development login only on a loopback address', () => {
    expect(problemsOf({ HB_PUBLIC_URL: 'https://homingbird.example.com', HB_DEV_LOGIN: '1' })).toContain(
      'HB_DEV_LOGIN: only allowed when HB_PUBLIC_URL is a loopback address',
    )
    expect(loaded({ HB_PUBLIC_URL: 'http://127.0.0.1:8080', HB_DEV_LOGIN: '1' }).identity).toMatchObject({
      devLogin: true,
      label: 'development login',
    })
  })

  it('shows every group by default, takes any minimum from 1, refuses 0, and reads a blank as unset', () => {
    expect(loaded(PRODUCTION).insights.minimumGroupSize).toBe(1)
    expect(loaded({ ...PRODUCTION, HB_INSIGHTS_MINIMUM_GROUP: '1' }).insights.minimumGroupSize).toBe(1)
    expect(loaded({ ...PRODUCTION, HB_INSIGHTS_MINIMUM_GROUP: '2' }).insights.minimumGroupSize).toBe(2)
    for (const refused of ['0', '-1', 'five'])
      expect(
        problemsOf({ ...PRODUCTION, HB_INSIGHTS_MINIMUM_GROUP: refused }).some((problem) =>
          problem.includes('HB_INSIGHTS_MINIMUM_GROUP'),
        ),
      ).toBe(true)
    expect(loaded({ ...PRODUCTION, HB_INSIGHTS_MINIMUM_GROUP: '' }).insights.minimumGroupSize).toBe(1)
  })

  it('keeps the audit trail for the 90-day minimum when HB_AUDIT_RETENTION_DAYS asks for less', () => {
    expect(loaded({ ...PRODUCTION, HB_AUDIT_RETENTION_DAYS: '30' })).toMatchObject({
      auditRetentionDays: 90,
      auditRetentionVariableDays: 30,
    })
    expect(loaded(PRODUCTION)).toMatchObject({ auditRetentionDays: 400, auditRetentionVariableDays: null })
  })

  it('tells the operator a renamed variable’s new name', () => {
    expect(problemsOf({ ...PRODUCTION, HB_TOPICS: 'general' })[0]).toContain('renamed to HB_CHANNELS')
  })

  it('reads seed channels with descriptions, host lists, and none for an empty list', () => {
    const config = loaded({
      ...PRODUCTION,
      HB_CHANNELS: 'general: Anything at all, billing',
      HB_OAUTH_REDIRECT_HOSTS: 'none',
      HB_PUSH_HOSTS: 'push.example.com',
    })
    expect(config.channels).toEqual([
      { slug: 'general', description: 'Anything at all' },
      { slug: 'billing', description: 'billing' },
    ])
    expect(config.oauth.redirectHosts).toEqual([])
    expect(config.pushHosts).toEqual(['push.example.com'])
    expect(problemsOf({ ...PRODUCTION, HB_OAUTH_REDIRECT_HOSTS: 'https://x' })[0]).toContain(
      'is not a host name',
    )
  })

  it('needs the address and key each analytics destination takes', () => {
    expect(problemsOf({ ...PRODUCTION, HB_ANALYTICS: 'posthog' })).toEqual([
      'HB_ANALYTICS_KEY: PostHog needs the project API key',
    ])
    expect(loaded({ ...PRODUCTION, HB_ANALYTICS: 'posthog', HB_ANALYTICS_KEY: 'phc' }).analytics).toEqual({
      kind: 'posthog',
      url: 'https://us.i.posthog.com',
      key: 'phc',
    })
    expect(problemsOf({ ...PRODUCTION, HB_ANALYTICS: 'ga4', HB_ANALYTICS_KEY: 'k' })[0]).toContain('GA4')
    expect(problemsOf({ ...PRODUCTION, HB_ANALYTICS: 'http' })[0]).toContain('HB_ANALYTICS=http')
    expect(
      loaded({ ...PRODUCTION, HB_ANALYTICS: 'http', HB_ANALYTICS_URL: 'https://events.example.com' })
        .analytics,
    ).toEqual({ kind: 'http', url: 'https://events.example.com', key: null })
  })

  it('notes a variable it ignores, and refuses an unknown feature switch', () => {
    expect(
      loaded({ ...PRODUCTION, HB_AUDIT_WEBHOOK_URL: 'https://hook.example.com' }).ignoredVariables,
    ).toEqual(['HB_AUDIT_WEBHOOK_URL'])
    expect(problemsOf({ ...PRODUCTION, HB_FEATURES: 'telepathy=on' })[0]).toContain('is not a feature switch')
  })
})
