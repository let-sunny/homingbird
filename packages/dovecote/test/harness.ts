import { Task as T, type TestClock, makeTestClock } from '@homingbird/kernel'
import type { Fetch } from '../src/auth/identity-provider.ts'
import { type Config, loadConfig } from '../src/config.ts'
import type { AppEnv } from '../src/environment.ts'
import { handleRequest } from '../src/http/app.ts'
import { SAME_SITE_HEADER, SESSION_COOKIE } from '../src/http/authenticate.ts'
import type { HttpResponse } from '../src/http/exchange.ts'
import { prepareDatabase } from '../src/prepare-database.ts'
import { type Runtime, buildRuntime } from '../src/runtime.ts'
import { type Database, type Row, all } from '../src/sql/database.ts'
import { openDatabase } from '../src/sql/open.ts'
import { raw } from '../src/sql/query.ts'
import { migrate, tableNames } from '../src/sql/schema.ts'
import { openSqlite } from '../src/sql/sqlite.ts'

export interface TestServer {
  readonly env: AppEnv
  readonly clock: TestClock
  readonly background: Runtime['background']
  readonly settled: () => Promise<void>
  readonly logged: string[]
  readonly request: (method: string, url: string, options?: RequestOptions) => Promise<TestResponse>
  readonly requestWithSettings: (overrides: Readonly<Record<string, string>>) => TestServer['request']
  readonly signIn: (email: string, name?: string) => Promise<Session>
  readonly close: () => Promise<void>
}

export interface RequestOptions {
  readonly token?: string
  readonly cookie?: string
  readonly body?: unknown
  readonly form?: Readonly<Record<string, string>>
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
}

export interface TestResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly json: any
  readonly raw: HttpResponse
}

export interface Session {
  readonly cookie: string
  readonly token: string
  readonly api: (method: string, path: string, body?: unknown) => Promise<TestResponse>
  readonly me: any
}

export interface Agent {
  readonly token: string
  readonly api: (method: string, path: string, body?: unknown) => Promise<TestResponse>
}

export const connectAgent = async (
  server: TestServer,
  owner: Session,
  options: { readonly name?: string } = {},
): Promise<Agent> => {
  const started = await server.request('POST', '/oauth/device_authorization', {
    form: { client_name: options.name ?? 'Test agent', scope: 'notes' },
  })
  await owner.api('POST', `/device/${started.json.user_code}`, {
    approve: true,
    name: options.name ?? 'Test agent',
  })
  const tokens = await server.request('POST', '/oauth/token', {
    form: {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: started.json.device_code,
    },
  })
  const token: string = tokens.json.access_token
  return {
    token,
    api: (method, path, body) =>
      server.request(method, `/api/v1${path}`, { token, ...(body !== undefined && { body }) }),
  }
}

export const PUBLIC_URL = 'http://localhost:8080'

export const testConfig = (overrides: Readonly<Record<string, string>> = {}): Config => {
  const loaded = loadConfig({
    HB_PUBLIC_URL: PUBLIC_URL,
    HB_DEV_LOGIN: '1',
    HB_ALLOWED_DOMAINS: 'example.com',
    ...overrides,
  })
  if (loaded._tag === 'Err') throw new Error(loaded.error.join('; '))
  return loaded.value
}

const NETWORK_ROUND_TRIPS_MS = 60

const patient = (clock: TestClock): TestClock => {
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, NETWORK_ROUND_TRIPS_MS))
  return {
    ...clock,
    flush: settle,
    advance: async (ms) => {
      await settle()
      await clock.advance(ms)
      await settle()
    },
  }
}

export const TEST_DATABASE_URL = process.env.HB_TEST_DATABASE_URL ?? null

export const openTestDatabase = async (url: string | null = TEST_DATABASE_URL): Promise<Database> => {
  if (url === null) return openSqlite(':memory:')
  const database = await openDatabase(url)
  for (const table of tableNames()) await database.run(raw(`DROP TABLE IF EXISTS ${table}`))
  return database
}

export const storedRows = async (server: TestServer, table: string): Promise<ReadonlyArray<Row>> =>
  T.runPromise(all(raw(`SELECT * FROM ${table}`)), server.env)

export const everyStoredValue = async (server: TestServer): Promise<string> => {
  const dump: string[] = []
  for (const table of tableNames()) dump.push(`${table}: ${JSON.stringify(await storedRows(server, table))}`)
  return dump.join('\n')
}

export const startTestServer = async (
  overrides: Readonly<Record<string, string>> = {},
  parts: { readonly fetch?: Fetch; readonly databaseUrl?: string } = {},
): Promise<TestServer> => {
  const clock = makeTestClock(1_700_000_000_000)
  const databaseUrl = parts.databaseUrl ?? TEST_DATABASE_URL
  const database = await openTestDatabase(databaseUrl)
  const logged: string[] = []
  const { env, background, settled } = buildRuntime({
    config: testConfig(overrides),
    database,
    clock,
    log: (line) => logged.push(line),
    ...(parts.fetch !== undefined && { fetch: parts.fetch }),
  })
  await T.runPromise(overrides.HB_CHANNELS === undefined ? migrate : prepareDatabase, env)

  const requestWith =
    (serving: AppEnv): TestServer['request'] =>
    async (method, url, options = {}) => {
      const parsed = new URL(url, PUBLIC_URL)
      const body =
        options.form !== undefined
          ? new URLSearchParams(options.form).toString()
          : options.body === undefined
            ? ''
            : JSON.stringify(options.body)
      const exit = await T.run(
        handleRequest({
          method,
          path: parsed.pathname,
          query: parsed.searchParams,
          headers: {
            ...(options.form !== undefined && { 'content-type': 'application/x-www-form-urlencoded' }),
            ...(options.body !== undefined && { 'content-type': 'application/json' }),
            ...(options.token !== undefined && { authorization: `Bearer ${options.token}` }),
            ...(options.cookie !== undefined && { cookie: options.cookie, [SAME_SITE_HEADER]: '1' }),
            ...options.headers,
          },
          body,
          remoteAddress: '127.0.0.1',
          disconnected: options.signal ?? new AbortController().signal,
        }),
        serving,
      )
      if (exit._tag === 'Err') throw new Error(`request died: ${JSON.stringify(exit.error)}`)
      const raw = exit.value
      const text = typeof raw.body === 'string' ? raw.body : ''
      return { status: raw.status, headers: raw.headers, json: parseOrNull(text), raw }
    }
  const request = requestWith(env)

  const signIn: TestServer['signIn'] = async (email, name = email.split('@')[0]!) => {
    const started = await request('GET', '/auth/login')
    const state = new URL(started.headers.location!).searchParams.get('state')!
    const submitted = await request('POST', '/auth/dev', { form: { email, name, state } })
    const finished = await request('GET', submitted.headers.location!)
    const setCookie = finished.headers['set-cookie']
    if (setCookie === undefined) throw new Error(`sign-in refused: ${finished.headers.location}`)
    const token = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookie)![1]!
    const cookie = `${SESSION_COOKIE}=${token}`
    const api: Session['api'] = (method, path, body) =>
      request(method, `/api/v1${path}`, { cookie, ...(body !== undefined && { body }) })
    return { cookie, token, api, me: (await api('GET', '/me')).json }
  }

  return {
    env,
    clock: databaseUrl === null ? clock : patient(clock),
    background,
    settled: () => T.runPromise(settled, env),
    logged,
    request,
    requestWithSettings: (changed) =>
      requestWith({ ...env, config: testConfig({ ...overrides, ...changed }) }),
    signIn,
    close: () => database.close(),
  }
}

const parseOrNull = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
