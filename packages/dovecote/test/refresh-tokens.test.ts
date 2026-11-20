import { createHash } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteSpentRefreshTokens } from '../src/domain/refresh-tokens.ts'
import { hashSecret } from '../src/random.ts'
import { run } from '../src/sql/database.ts'
import { sql } from '../src/sql/query.ts'
import { type Session, type TestServer, meanwhile, startTestServer, storedRows } from './harness.ts'

const REDIRECT = 'https://client.example/callback'
const VERIFIER = 'v'.repeat(64)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const DAY_MS = 24 * 60 * 60_000

let server: TestServer
let ana: Session

beforeEach(async () => {
  server = await startTestServer({ HB_OAUTH_REDIRECT_HOSTS: 'client.example' })
  ana = await server.signIn('ana@example.com', 'Ana')
})

afterEach(() => server.close())

const token = (form: Record<string, string>) => server.request('POST', '/oauth/token', { form })

const refresh = (refreshToken: string) => token({ grant_type: 'refresh_token', refresh_token: refreshToken })

const connect = async (): Promise<{ access_token: string; refresh_token: string }> => {
  const { client_id: clientId } = (
    await server.request('POST', '/oauth/register', {
      body: { client_name: 'Connector', redirect_uris: [REDIRECT] },
    })
  ).json
  const authorized = await server.request(
    'GET',
    `/oauth/authorize?${new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      state: 'xyz',
    })}`,
    { cookie: ana.cookie },
  )
  const consentId = authorized.headers.location!.split('/#/consent/')[1]!
  const decided = await ana.api('POST', `/consent/${consentId}`, { approve: true, name: 'My connector' })
  const code = new URL(decided.json.redirectTo).searchParams.get('code')!
  return (
    await token({
      grant_type: 'authorization_code',
      code,
      code_verifier: VERIFIER,
      client_id: clientId,
      redirect_uri: REDIRECT,
    })
  ).json
}

const reads = async (accessToken: string) =>
  (await server.request('GET', '/api/v1/me', { token: accessToken })).status

const drafts = async (accessToken: string) =>
  (
    await server.request('POST', '/api/v1/drafts', {
      token: accessToken,
      body: { to: [ana.me.member.id], body: 'A draft' },
    })
  ).status

const revocations = async () =>
  (await storedRows(server, 'audit_events')).filter((row) => row.event === 'credential.revoked')

describe('rotating refresh tokens', () => {
  it('gives a new access token and refresh token each time, and the old access token stops working', async () => {
    const first = await connect()
    const second = (await refresh(first.refresh_token)).json
    expect(second.refresh_token).toMatch(/^hbr_/)
    expect(second.refresh_token).not.toBe(first.refresh_token)
    expect(await reads(first.access_token)).toBe(401)
    expect(await reads(second.access_token)).toBe(200)
    const third = await refresh(second.refresh_token)
    expect(third.status).toBe(200)
    expect(await reads(third.json.access_token)).toBe(200)
  })

  it('keeps each spent refresh token by its hash only', async () => {
    const first = await connect()
    await refresh(first.refresh_token)
    const spent = await storedRows(server, 'spent_refresh_tokens')
    expect(spent.map((row) => row.refresh_hash)).toEqual([hashSecret(first.refresh_token)])
    expect(JSON.stringify(spent)).not.toContain(first.refresh_token)
  })
})

describe('a spent refresh token presented again', () => {
  it('revokes the whole credential, its newest access and refresh tokens with it, and answers invalid_grant', async () => {
    const first = await connect()
    const second = (await refresh(first.refresh_token)).json
    await server.clock.advance(11_000)
    const replayed = await refresh(first.refresh_token)
    expect(replayed.status).toBe(400)
    expect(replayed.json.error).toBe('invalid_grant')
    expect(await reads(second.access_token)).toBe(401)
    expect(await drafts(second.access_token)).toBe(401)
    expect((await refresh(second.refresh_token)).json.error).toBe('invalid_grant')
  })

  it('writes one security audit row naming the credential and the reason, and nothing of the token', async () => {
    const first = await connect()
    const second = (await refresh(first.refresh_token)).json
    await server.clock.advance(11_000)
    await refresh(first.refresh_token)
    await refresh(first.refresh_token)
    const [credential] = await storedRows(server, 'credentials').then((rows) =>
      rows.filter((row) => row.client === 'Connector'),
    )
    const rows = await revocations()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actor_id: null, credential_id: null, target_id: credential!.id })
    expect(JSON.parse(String(rows[0]!.detail))).toEqual({ because: 'refresh_replayed' })
    const stored = JSON.stringify(await storedRows(server, 'audit_events'))
    for (const secret of [first.refresh_token, second.refresh_token, second.access_token])
      for (const form of [secret, hashSecret(secret)]) expect(stored).not.toContain(form)
  })

  it('leaves the person’s other credentials working', async () => {
    const replayedOne = await connect()
    const other = await connect()
    await refresh(replayedOne.refresh_token)
    await server.clock.advance(11_000)
    await refresh(replayedOne.refresh_token)
    expect(await reads(other.access_token)).toBe(200)
    expect(await reads(ana.token)).toBe(200)
  })
})

describe('the grace for a client that repeats a refresh', () => {
  it('refuses a repeat of the token the live one replaced within ten seconds, without revoking anything', async () => {
    const first = await connect()
    const second = (await refresh(first.refresh_token)).json
    await server.clock.advance(10_000)
    expect((await refresh(first.refresh_token)).json.error).toBe('invalid_grant')
    expect(await reads(second.access_token)).toBe(200)
    expect(await drafts(second.access_token)).not.toBe(401)
    expect((await refresh(second.refresh_token)).status).toBe(200)
    expect(await revocations()).toEqual([])
  })

  it('revokes for an older token within ten seconds, since only the one the live token replaced is a retry', async () => {
    const first = await connect()
    const second = (await refresh(first.refresh_token)).json
    const third = (await refresh(second.refresh_token)).json
    await server.clock.advance(5_000)
    expect((await refresh(first.refresh_token)).json.error).toBe('invalid_grant')
    expect(await reads(third.access_token)).toBe(401)
    expect((await revocations()).map((row) => JSON.parse(String(row.detail)))).toEqual([
      { because: 'refresh_replayed' },
    ])
  })

  it('tells the token the live one replaced by what was stored, even when both refreshes share a millisecond', async () => {
    const first = await connect()
    const second = (await refresh(first.refresh_token)).json
    const third = (await refresh(second.refresh_token)).json
    expect((await refresh(second.refresh_token)).json.error).toBe('invalid_grant')
    expect(await reads(third.access_token)).toBe(200)
    expect(await revocations()).toEqual([])
    expect((await refresh(first.refresh_token)).json.error).toBe('invalid_grant')
    expect(await reads(third.access_token)).toBe(401)
  })

  it('refuses the loser of two refreshes in flight at once without revoking the winner', async () => {
    const first = await connect()
    const winner = 'hbr_winner'
    const race = meanwhile(server, /UPDATE credentials SET token_hash/, [
      sql`UPDATE credentials SET refresh_hash = ${hashSecret(winner)} WHERE refresh_hash = ${hashSecret(first.refresh_token)}`,
    ])
    const lost = await race.request('POST', '/oauth/token', {
      form: { grant_type: 'refresh_token', refresh_token: first.refresh_token },
    })
    expect(lost.json.error).toBe('invalid_grant')
    expect((await refresh(winner)).status).toBe(200)
    expect(await revocations()).toEqual([])
  })
  it('issues nothing when a replay revokes the credential while a refresh is rotating it', async () => {
    const first = await connect()
    const [credential] = (await storedRows(server, 'credentials')).filter((row) => row.client === 'Connector')
    const race = meanwhile(server, /UPDATE credentials SET token_hash/, [
      sql`UPDATE credentials SET revoked_at = ${server.clock.now()} WHERE id = ${String(credential!.id)}`,
    ])
    const lost = await race.request('POST', '/oauth/token', {
      form: { grant_type: 'refresh_token', refresh_token: first.refresh_token },
    })
    expect(lost.json.error).toBe('invalid_grant')
    expect(lost.json.access_token).toBeUndefined()
    expect(await storedRows(server, 'spent_refresh_tokens')).toEqual([])
    expect(await reads(first.access_token)).toBe(401)
  })
})

describe('refreshing for a member', () => {
  it('keeps refreshing for an active member who has not signed in to the web client for a long time', async () => {
    let current = await connect()
    for (let day = 0; day < 60; day += 20) {
      await server.clock.advance(20 * DAY_MS)
      const renewed = await refresh(current.refresh_token)
      expect(renewed.status).toBe(200)
      current = renewed.json
    }
    expect(await reads(current.access_token)).toBe(200)
  })

  it('refuses for a member who is no longer active, even with a credential left unrevoked', async () => {
    const first = await connect()
    await T.runPromise(
      run(sql`UPDATE members SET status = 'deactivated' WHERE id = ${ana.me.member.id}`),
      server.env,
    )
    expect((await refresh(first.refresh_token)).json.error).toBe('invalid_grant')
  })
})

describe('deleting spent refresh tokens', () => {
  it('deletes them once their credential is revoked', async () => {
    const first = await connect()
    const second = (await refresh(first.refresh_token)).json
    await server.request('POST', '/oauth/revoke', { form: { token: second.access_token } })
    await T.runPromise(deleteSpentRefreshTokens(server.clock.now()), server.env)
    expect(await storedRows(server, 'spent_refresh_tokens')).toEqual([])
  })

  it('keeps them while their credential is unexpired and deletes them after', async () => {
    const first = await connect()
    await refresh(first.refresh_token)
    await T.runPromise(deleteSpentRefreshTokens(server.clock.now()), server.env)
    expect(await storedRows(server, 'spent_refresh_tokens')).toHaveLength(1)
    await server.clock.advance(90 * DAY_MS)
    await T.runPromise(deleteSpentRefreshTokens(server.clock.now()), server.env)
    expect(await storedRows(server, 'spent_refresh_tokens')).toEqual([])
  })
})
