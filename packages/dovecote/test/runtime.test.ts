import { Task as T, makeTestClock } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildRuntime, housekeepingPass } from '../src/runtime.ts'
import { run } from '../src/sql/database.ts'
import { raw } from '../src/sql/query.ts'
import { migrate } from '../src/sql/schema.ts'
import { openSqlite } from '../src/sql/sqlite.ts'
import { type Session, type TestServer, startTestServer, storedRows, testConfig } from './harness.ts'

const DAY_MS = 24 * 60 * 60_000

describe('building the runtime', () => {
  it('uses the development login only when configured, and the system clock when none is given', async () => {
    const database = openSqlite(':memory:')
    const lines: string[] = []
    const runtime = buildRuntime({ config: testConfig(), database, write: (line) => lines.push(line) })
    expect(Math.abs(runtime.env.clock.now() - Date.now())).toBeLessThan(5_000)
    expect(
      await T.runPromise(
        runtime.env.identityProvider.authorizationUrl({
          state: 's',
          nonce: '',
          codeChallenge: '',
          redirectUri: '',
        }),
      ),
    ).toContain('/auth/dev?state=s')
    expect(runtime.env.random.identifier()).toMatch(/^[0-9a-z]{20}$/)
    runtime.env.log.emit({ name: 'audit.chain_head', attributes: { id: 0, hash: 'h' } })
    expect(lines.join('\n')).toContain('audit.chain_head')
    await T.runPromise(runtime.settled)
    await T.runPromise(database.close)
  })

  it('runs its background work until it is interrupted', async () => {
    const database = openSqlite(':memory:')
    const clock = makeTestClock(1_700_000_000_000)
    const runtime = buildRuntime({ config: testConfig(), database, clock, write: () => {} })
    await T.runPromise(T.asUnit(migrate), runtime.env)
    const running = T.runFork(runtime.background, runtime.env)
    await clock.advance(60 * 60_000)
    running.interrupt()
    expect((await running.exit)._tag).toBe('Err')
    await T.runPromise(database.close)
  })
})

describe('the housekeeping pass', () => {
  let server: TestServer
  let ana: Session

  beforeEach(async () => {
    server = await startTestServer()
    ana = await server.signIn('ana@example.com', 'Ana')
  })

  afterEach(() => server.close())

  it('forgets events a week old and expired sign-in requests, and keeps the recent ones', async () => {
    const ben = await server.signIn('ben@example.com', 'Ben')
    const draft = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'Old' })).json
    await ana.api('POST', `/drafts/${draft.id}/send`, {})
    await T.runPromise(
      run(
        raw(
          "INSERT INTO auth_requests (id, kind, status, secret_hash, user_code, member_id, detail, created_at, expires_at) VALUES ('old', 'sign_in', 'pending', NULL, NULL, NULL, '{}', 0, 1)",
        ),
      ),
      server.env,
    )
    await server.clock.advance(7 * DAY_MS + 1)
    const recent = (await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'New' })).json
    await T.runPromise(housekeepingPass, server.env)
    const events = await storedRows(server, 'events')
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((event) => Number(event.created_at) >= recent.createdAt)).toBe(true)
    expect((await storedRows(server, 'auth_requests')).map((row) => row.id)).not.toContain('old')
  })
})
