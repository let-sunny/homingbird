import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { LIMITS, makeRateLimiter } from '../src/http/rate-limiter.ts'
import { cryptoRandom, hashSecret, normalizeUserCode } from '../src/random.ts'
import { openDatabase } from '../src/sql/open.ts'
import {
  containsIgnoringCase,
  insertIgnoringConflict,
  insertInto,
  join as joinQueries,
  list,
  numberedPlaceholders,
  raw,
  sql,
} from '../src/sql/query.ts'
import { schemaStatements } from '../src/sql/schema.ts'
import { type TestServer, startTestServer } from './harness.ts'

describe('configuration', () => {
  const minimal = {
    HB_PUBLIC_URL: 'https://hb.example.com/',
    HB_OIDC_CLIENT_ID: 'id',
    HB_OIDC_CLIENT_SECRET: 'secret',
    HB_ADMIN_EMAILS: 'root@example.com',
  }

  it('fills in defaults', () => {
    const config = loadConfig(minimal)
    expect(config).toMatchObject({
      _tag: 'Ok',
      value: {
        publicUrl: 'https://hb.example.com',
        port: 8080,
        databaseUrl: 'sqlite:./data/dovecote.sqlite',
        webDirectory: null,
        themeDirectory: null,
        identity: { issuer: 'https://accounts.google.com', label: 'Google', devLogin: false },
        initial: { allowedDomains: [], contactMode: 'open', auditRetentionDays: null },
        adminEmails: ['root@example.com'],
        trustedProxies: 0,
        sessionDays: 30,
        agentCredentialDays: 90,
        audit: { toStdout: false, webhookUrl: null },
        oauth: {
          redirectHosts: ['claude.ai', 'claude.com'],
          clientMetadataHosts: ['claude.ai', 'claude.com'],
          clients: [],
        },
      },
    })
  })

  it('reads every variable, trimming lists and ignoring blanks', () => {
    const config = loadConfig({
      ...minimal,
      HB_PORT: '9000',
      HB_DATABASE_URL: 'postgres://db/hb',
      HB_WEB_DIR: '/web',
      HB_THEME_DIR: '/theme',
      HB_OIDC_ISSUER: 'https://idp.example.com/',
      HB_OIDC_LABEL: 'Okta',
      HB_ALLOWED_DOMAINS: ' Example.com , partner.org ,',
      HB_ADMIN_EMAILS: 'Root@Example.com',
      HB_CONTACT_MODE: 'contacts',
      HB_AUDIT_RETENTION_DAYS: '365',
      HB_SESSION_DAYS: '7',
      HB_AGENT_CREDENTIAL_DAYS: '14',
      HB_AUDIT_STDOUT: '1',
      HB_AUDIT_WEBHOOK_URL: 'https://siem.example.com/in',
      HB_TRUST_PROXY: '2',
      HB_PUSH_HOSTS: 'push.example.com',
      HB_OAUTH_REDIRECT_HOSTS: 'claude.ai, Agent.Example',
      HB_OAUTH_CLIENT_METADATA_HOSTS: 'none',
      HB_OAUTH_CLIENTS: 'tool|Tool|https://tool.example/cb',
      HB_DEV_LOGIN: '',
    })
    expect(config).toMatchObject({
      _tag: 'Ok',
      value: {
        port: 9000,
        databaseUrl: 'postgres://db/hb',
        webDirectory: '/web',
        themeDirectory: '/theme',
        identity: { issuer: 'https://idp.example.com', label: 'Okta' },
        initial: {
          allowedDomains: ['example.com', 'partner.org'],
          contactMode: 'contacts',
          auditRetentionDays: 365,
        },
        adminEmails: ['root@example.com'],
        trustedProxies: 2,
        pushHosts: ['push.example.com'],
        sessionDays: 7,
        agentCredentialDays: 14,
        audit: { toStdout: true, webhookUrl: 'https://siem.example.com/in' },
        oauth: {
          redirectHosts: ['claude.ai', 'agent.example'],
          clientMetadataHosts: [],
          clients: [{ client_id: 'tool', client_name: 'Tool', redirect_uris: ['https://tool.example/cb'] }],
        },
      },
    })
  })

  it.each([
    [{}, /HB_PUBLIC_URL/],
    [{ HB_PUBLIC_URL: 'hb.example.com' }, /HB_PUBLIC_URL/],
    [{ HB_PUBLIC_URL: 'https://hb.example.com' }, /HB_OIDC_CLIENT_ID.*HB_OIDC_CLIENT_SECRET/s],
    [{ ...minimal, HB_ADMIN_EMAILS: ' , ' }, /HB_ADMIN_EMAILS: name at least one administrator/],
    [{ ...minimal, HB_PORT: 'eighty' }, /HB_PORT/],
    [{ ...minimal, HB_DATABASE_URL: 'oracle://x' }, /HB_DATABASE_URL/],
    [{ ...minimal, HB_CONTACT_MODE: 'everyone' }, /HB_CONTACT_MODE/],
    [{ ...minimal, HB_TRUST_PROXY: 'yes' }, /HB_TRUST_PROXY/],
    [{ ...minimal, HB_TRUST_PROXY: '-1' }, /HB_TRUST_PROXY/],
    [{ ...minimal, HB_TRUST_PROXY: '10' }, /HB_TRUST_PROXY/],
    [{ HB_PUBLIC_URL: 'https://hb.example.com', HB_DEV_LOGIN: '1' }, /loopback/],
    [
      { ...minimal, HB_OAUTH_REDIRECT_HOSTS: 'https://claude.ai' },
      /HB_OAUTH_REDIRECT_HOSTS: "https:\/\/claude.ai" is not a host name/,
    ],
    [
      { ...minimal, HB_OAUTH_CLIENT_METADATA_HOSTS: 'claude.ai, 127.0.0.1' },
      /HB_OAUTH_CLIENT_METADATA_HOSTS: "127.0.0.1" must be a public host name/,
    ],
    [{ ...minimal, HB_OAUTH_CLIENT_METADATA_HOSTS: 'localhost' }, /"localhost" must be a public host name/],
    [
      { ...minimal, HB_OAUTH_CLIENTS: 'tool|Tool|http://tool.example/cb' },
      /HB_OAUTH_CLIENTS: client 1 \("tool"\) has redirect URI/,
    ],
  ])('refuses %j', (environment, problem) => {
    const config = loadConfig(environment)
    expect(config._tag).toBe('Err')
    expect((config as unknown as { error: string[] }).error.join('\n')).toMatch(problem)
  })

  it('reports every OAuth client problem at once, alongside the other problems', () => {
    const config = loadConfig({
      ...minimal,
      HB_ADMIN_EMAILS: '',
      HB_OAUTH_REDIRECT_HOSTS: 'a b',
      HB_OAUTH_CLIENTS: 'a||https://a.example/cb,client_b|B|https://b.example/cb',
    })
    expect(config).toMatchObject({
      _tag: 'Err',
      error: [
        'HB_ADMIN_EMAILS: name at least one administrator; nobody becomes one implicitly',
        'HB_OAUTH_REDIRECT_HOSTS: "a b" is not a host name',
        'HB_OAUTH_CLIENTS: client 1 ("a") needs a name of 1 to 200 characters',
        'HB_OAUTH_CLIENTS: client 2 ("client_b") may not start with "client_", which registration uses',
      ],
    })
  })

  it.each(['http://localhost:8080', 'http://127.0.0.1', 'http://[::1]:3000/'])(
    'allows development login on %s',
    (url) => {
      expect(loadConfig({ HB_PUBLIC_URL: url, HB_DEV_LOGIN: '1' })).toMatchObject({
        _tag: 'Ok',
        value: { identity: { devLogin: true, label: 'development login' } },
      })
    },
  )
})

describe('the rate limiter', () => {
  it('allows the limit within a window, then refuses until the window passes, per key', () => {
    let now = 0
    const limiter = makeRateLimiter(() => now)
    const limit = { max: 3, windowMs: 1_000 }
    expect([1, 2, 3, 4].map(() => limiter.allow('a', limit))).toEqual([true, true, true, false])
    expect(limiter.allow('b', limit)).toBe(true)
    now = 999
    expect(limiter.allow('a', limit)).toBe(false)
    now = 1_000
    expect(limiter.allow('a', limit)).toBe(true)
  })

  it('forgets expired keys once it tracks too many', () => {
    let now = 0
    const limiter = makeRateLimiter(() => now)
    for (let key = 0; key <= 50_000; key++) limiter.allow(`k${key}`, LIMITS.drafting)
    limiter.allow('k0', { max: 1, windowMs: 3_600_000 * 2 })
    now = 3_600_000
    expect(limiter.allow('fresh', LIMITS.drafting)).toBe(true)
    expect(limiter.allow('k0', { max: 1, windowMs: 3_600_000 * 2 })).toBe(true)
  })
})

describe('random values', () => {
  it('produces identifiers, secrets and user codes of the documented shapes', () => {
    expect(cryptoRandom.identifier()).toMatch(/^[0-9a-z]{20}$/)
    expect(cryptoRandom.secret()).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(cryptoRandom.userCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
    expect(new Set(Array.from({ length: 100 }, cryptoRandom.secret)).size).toBe(100)
  })

  it('hashes secrets with SHA-256 and normalizes typed user codes', () => {
    expect(hashSecret('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(normalizeUserCode(' bcdf ghjk ')).toBe('BCDF-GHJK')
    expect(normalizeUserCode('bcdfghjkextra')).toBe('BCDF-GHJK')
  })
})

describe('query building', () => {
  it('inlines nested queries and collects parameters in order', () => {
    const inner = sql`b = ${2}`
    expect(sql`SELECT * FROM t WHERE a = ${1} AND ${inner} AND c IN ${list([3, 4])}`).toMatchObject({
      text: 'SELECT * FROM t WHERE a = ? AND b = ? AND c IN (?, ?)',
      params: [1, 2, 3, 4],
    })
    expect(joinQueries([raw('x'), sql`y = ${1}`], ' AND ')).toMatchObject({
      text: 'x AND y = ?',
      params: [1],
    })
    expect(() => list([])).toThrow(RangeError)
  })

  it('builds inserts for each dialect', () => {
    expect(insertInto('t', { a: 1, b: 'x' })).toMatchObject({
      text: 'INSERT INTO t (a, b) VALUES (?, ?)',
      params: [1, 'x'],
    })
    expect(insertIgnoringConflict('mysql', 't', { a: 1 }).text).toBe('INSERT IGNORE INTO t (a) VALUES (?)')
    expect(insertIgnoringConflict('postgres', 't', { a: 1 }).text).toBe(
      'INSERT INTO t (a) VALUES (?) ON CONFLICT DO NOTHING',
    )
    expect(insertIgnoringConflict('sqlite', 't', { a: 1 }).text).toBe(
      'INSERT INTO t (a) VALUES (?) ON CONFLICT DO NOTHING',
    )
  })

  it('escapes wildcards in searches and numbers placeholders for PostgreSQL', () => {
    expect(containsIgnoringCase('body', '50%_Off!')).toMatchObject({
      text: "LOWER(body) LIKE ? ESCAPE '!'",
      params: ['%50!%!_off!!%'],
    })
    expect(numberedPlaceholders('a = ? AND b IN (?, ?)')).toBe('a = $1 AND b IN ($2, $3)')
  })
})

describe('schema', () => {
  it.each(['sqlite', 'postgres', 'mysql'] as const)('generates stable DDL for %s', (dialect) => {
    expect(schemaStatements(dialect)).toMatchSnapshot()
  })

  it('refuses a database URL it does not understand', async () => {
    await expect(openDatabase('oracle://x')).rejects.toThrow(/sqlite:, postgres: or mysql:/)
  })

  it('opens a SQLite file, creating its directory', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'hb-')), 'nested', 'db.sqlite')
    const database = await openDatabase(`sqlite:${path}`)
    await database.run(raw('CREATE TABLE t (a INTEGER)'))
    await expect(
      database.transaction(async (connection) => {
        await connection.run(raw('INSERT INTO t (a) VALUES (1)'))
        throw new Error('roll back')
      }),
    ).rejects.toThrow('roll back')
    expect(await database.all(raw('SELECT * FROM t'))).toEqual([])
    await database.close()
  })
})

describe('static files and branding', () => {
  let server: TestServer
  afterEach(() => server.close())

  const withFiles = async () => {
    const web = mkdtempSync(join(tmpdir(), 'hb-web-'))
    const theme = mkdtempSync(join(tmpdir(), 'hb-theme-'))
    mkdirSync(join(web, 'assets'))
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>Homingbird</title>')
    writeFileSync(join(web, 'app.js'), 'console.log(1)')
    writeFileSync(join(web, 'assets', 'pip.png'), Buffer.from([1, 2, 3]))
    writeFileSync(join(web, 'data.bin'), 'x')
    writeFileSync(join(theme, 'secret.txt'), 'do not serve')
    server = await startTestServer({ HB_WEB_DIR: web, HB_THEME_DIR: theme })
    return { web, theme }
  }

  it('serves assets with types, caching and security headers, and the app shell for any other path', async () => {
    await withFiles()
    const script = await server.request('GET', '/app.js')
    expect(script.headers).toMatchObject({
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    })
    expect(script.headers['content-security-policy']).toContain("script-src 'self'")
    expect(script.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect((await server.request('GET', '/assets/pip.png')).headers['content-type']).toBe('image/png')
    expect((await server.request('GET', '/data.bin')).headers['content-type']).toBe(
      'application/octet-stream',
    )
    for (const path of ['/', '/index.html', '/c/conv_1', '/missing.js']) {
      const shell = await server.request('GET', path)
      expect([path, shell.status, shell.headers['cache-control']]).toEqual([path, 200, 'no-cache'])
      expect(String(Buffer.from(shell.raw.body as Uint8Array))).toContain('<title>Homingbird</title>')
    }
  })

  it.each([
    '/../secret.txt',
    '/..%2f..%2fetc%2fpasswd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/assets/../../secret.txt',
    '/%E0%A4%A',
  ])('never leaves the web directory for %s', async (path) => {
    await withFiles()
    const response = await server.request('GET', path)
    const body = String(Buffer.from(response.raw.body as Uint8Array))
    expect(body).not.toContain('do not serve')
    expect(body).not.toContain('root:')
  })

  it('serves an empty theme and default branding until the organization provides its own', async () => {
    const { theme } = await withFiles()
    expect(String(Buffer.from((await server.request('GET', '/theme.css')).raw.body as Uint8Array))).toContain(
      'no organization theme',
    )
    expect((await server.request('GET', '/branding.json')).json).toEqual({ name: 'Homingbird', logo: null })
    writeFileSync(join(theme, 'theme.css'), ':root { --pip-blue: red }')
    writeFileSync(join(theme, 'branding.json'), '{"name":"Acme Notes"}')
    const css = await server.request('GET', '/theme.css')
    expect(String(Buffer.from(css.raw.body as Uint8Array))).toContain('--pip-blue: red')
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8')
    expect((await server.request('GET', '/branding.json')).json).toEqual({ name: 'Acme Notes', logo: null })
    writeFileSync(join(theme, 'branding.json'), '{broken')
    expect((await server.request('GET', '/branding.json')).json).toEqual({ name: 'Homingbird', logo: null })
  })

  it('answers plainly when no web client is installed, and refuses writes', async () => {
    server = await startTestServer()
    expect((await server.request('GET', '/')).status).toBe(404)
    expect((await server.request('GET', '/theme.css')).status).toBe(200)
    expect((await server.request('POST', '/')).status).toBe(405)
    expect((await server.request('GET', '/healthz')).json).toEqual({ status: 'ok' })
  })
})
