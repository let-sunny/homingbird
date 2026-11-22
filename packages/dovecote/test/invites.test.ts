import { afterEach, describe, expect, it } from 'vitest'
import { mayInvite } from '../src/auth/invites.ts'
import { SESSION_COOKIE } from '../src/http/authenticate.ts'
import { type FakeIssuer, makeFakeIssuer } from './fake-identity-issuer.ts'
import { type Session, type TestServer, everyStoredValue, startTestServer, storedRows } from './harness.ts'

let server: TestServer
let closed: TestServer | undefined
afterEach(async () => {
  if (server !== closed) await server?.close()
  closed = server
})

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000

const codeOf = (url: string): string => url.split('#/invite/')[1]!

const reasonOf = (location: string): URLSearchParams => new URLSearchParams(location.split('?')[1])

/** Opens an invite link and signs in with development login; the cookie, or where the browser was sent. */
const accept = async (code: string, email: string) => {
  const opened = await server.request('POST', '/auth/invite', { form: { code } })
  if (opened.status !== 302) return { status: opened.status, location: '', cookie: undefined }
  if (opened.headers.location!.startsWith('/#/'))
    return { status: 302, location: opened.headers.location!, cookie: undefined }
  const state = new URL(opened.headers.location!, 'http://localhost:8080').searchParams.get('state')!
  const submitted = await server.request('POST', '/auth/dev', { form: { email, name: email, state } })
  const finished = await server.request('GET', submitted.headers.location!)
  return {
    status: finished.status,
    location: finished.headers.location!,
    cookie: finished.headers['set-cookie']?.split(';')[0],
  }
}

const invite = async (by: Session, email?: string): Promise<string> => {
  const made = await by.api('POST', '/invites', email === undefined ? {} : { email })
  expect(made.status).toBe(200)
  return codeOf(made.json.url)
}

const setWhoCanInvite = async (admin: Session, whoCanInvite: string) => {
  const current = (await admin.api('GET', '/admin/settings')).json
  expect((await admin.api('PUT', '/admin/settings', { ...current, whoCanInvite })).status).toBe(200)
}

const expectRefused = (accepted: { location: string; cookie: string | undefined }) => {
  expect(accepted.cookie).toBeUndefined()
  expect(accepted.location).toBe('/#/invite-refused')
}

describe('invite links', () => {
  it('admit one person from outside the allowed domains, once, from a link shown only when it is made', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const made = await ana.api('POST', '/invites', {})
    expect(made.json).toEqual({
      invite: {
        id: expect.any(String),
        email: null,
        createdBy: ana.me.member.id,
        createdAt: server.clock.now(),
        expiresAt: server.clock.now() + SEVEN_DAYS_MS,
      },
      url: expect.stringMatching(/^http:\/\/localhost:8080\/#\/invite\/hbi_[A-Za-z0-9_-]{43}$/),
    })
    const code = codeOf(made.json.url)
    expect((await ana.api('GET', '/invites')).json.invites).toEqual([made.json.invite])

    const accepted = await accept(code, 'friend@gmail.test')
    expect(accepted).toMatchObject({ status: 302, location: '/' })
    const me = await server.request('GET', '/api/v1/me', { cookie: accepted.cookie! })
    expect(me.json.member).toMatchObject({ email: 'friend@gmail.test', role: 'member', status: 'active' })
    expect((await ana.api('GET', '/invites')).json.invites).toEqual([])
    expectRefused(await accept(code, 'other@gmail.test'))

    const secret = code.slice('hbi_'.length)
    expect(await everyStoredValue(server)).not.toContain(secret)
    expect(server.logged.join('\n')).not.toContain(secret)
  })

  it('are audited by invite and member id, never by the link', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const code = await invite(ana, 'friend@gmail.test')
    const revoked = (await ana.api('POST', '/invites', {})).json.invite.id
    await ana.api('DELETE', `/invites/${revoked}`)
    const accepted = await accept(code, 'friend@gmail.test')
    const friend = (await server.request('GET', '/api/v1/me', { cookie: accepted.cookie! })).json.member
    const rows = (await storedRows(server, 'audit_events')).filter((row) =>
      String(row.event).startsWith('member.invite_'),
    )
    const [created, , , redeemed] = rows
    expect(rows.map((row) => [row.event, row.actor_id, row.target_kind])).toEqual([
      ['member.invite_created', ana.me.member.id, 'auth_request'],
      ['member.invite_created', ana.me.member.id, 'auth_request'],
      ['member.invite_revoked', ana.me.member.id, 'auth_request'],
      ['member.invite_redeemed', friend.id, 'auth_request'],
    ])
    expect(JSON.parse(String(created!.detail))).toEqual({ boundToEmail: true })
    expect(redeemed!.target_id).toBe(created!.target_id)
    expect(JSON.parse(String(redeemed!.detail))).toEqual({ memberId: friend.id })
    expect(JSON.stringify(rows)).not.toContain(code.slice(4))
    expect(JSON.stringify(rows)).not.toContain('friend@gmail.test')
  })

  it('bound to an address admit only that address, and stay unspent for it after another one tried', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const code = await invite(ana, 'Friend@Gmail.test')
    expect((await ana.api('GET', '/invites')).json.invites[0].email).toBe('friend@gmail.test')
    expectRefused(await accept(code, 'stranger@gmail.test'))
    expect((await ana.api('GET', '/invites')).json.invites).toHaveLength(1)
    expect((await accept(code, 'friend@gmail.test')).cookie).toBeDefined()
  })

  it('refuse an unknown, malformed, expired or revoked link with the same sentence', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    expectRefused(await accept('hbi_unknown', 'friend@gmail.test'))
    expectRefused(await accept('not-an-invite', 'friend@gmail.test'))
    const expiring = await invite(ana)
    const revoked = await ana.api('POST', '/invites', {})
    expect((await ana.api('DELETE', `/invites/${revoked.json.invite.id}`)).status).toBe(200)
    expect((await ana.api('DELETE', `/invites/${revoked.json.invite.id}`)).status).toBe(404)
    expectRefused(await accept(codeOf(revoked.json.url), 'friend@gmail.test'))
    await server.clock.advance(SEVEN_DAYS_MS)
    expectRefused(await accept(expiring, 'friend@gmail.test'))
  })

  it('refuse a link opened in time whose invite was revoked before sign-in finished', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const made = (await ana.api('POST', '/invites', {})).json
    const opened = await server.request('POST', '/auth/invite', { form: { code: codeOf(made.url) } })
    await ana.api('DELETE', `/invites/${made.invite.id}`)
    const state = new URL(opened.headers.location!, 'http://localhost:8080').searchParams.get('state')!
    const submitted = await server.request('POST', '/auth/dev', {
      form: { email: 'friend@gmail.test', name: 'Friend', state },
    })
    const finished = await server.request('GET', submitted.headers.location!)
    expectRefused({ location: finished.headers.location!, cookie: finished.headers['set-cookie'] })
  })

  it('opened by someone the allowed domains already admit leave the invite unspent', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const code = await invite(ana)
    expect((await accept(code, 'ben@example.com')).cookie).toBeDefined()
    expect((await ana.api('GET', '/invites')).json.invites).toHaveLength(1)
  })

  it('stop working when their maker is deactivated', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const cy = await server.signIn('cy@example.com', 'Cy')
    await ana.api('PATCH', `/admin/members/${cy.me.member.id}`, { role: 'admin' })
    const code = await invite(cy)
    await ana.api('PATCH', `/admin/members/${cy.me.member.id}`, { status: 'deactivated' })
    expectRefused(await accept(code, 'friend@gmail.test'))
  })

  it('are refused to a member who opens one with an address of a deactivated member, and stay unspent', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const ben = await server.signIn('ben@example.com', 'Ben')
    await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { status: 'deactivated' })
    const code = await invite(ana)
    const accepted = await accept(code, 'ben@example.com')
    expect(accepted.cookie).toBeUndefined()
    expect(reasonOf(accepted.location).get('reason')).toMatch(/deactivated/)
    expect((await ana.api('GET', '/invites')).json.invites).toHaveLength(1)
  })

  it('are made by administrators only, unless the organization lets every member invite', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const ben = await server.signIn('ben@example.com', 'Ben')
    expect([ana.me.canInvite, ben.me.canInvite]).toEqual([true, false])
    expect((await ben.api('POST', '/invites', {})).status).toBe(403)
    expect((await ben.api('GET', '/invites')).status).toBe(403)
    expect((await ana.api('GET', '/admin/settings')).json.whoCanInvite).toBe('admins')

    await setWhoCanInvite(ana, 'members')
    expect((await ben.api('GET', '/me')).json.canInvite).toBe(true)
    const bens = await ben.api('POST', '/invites', {})
    const anas = await ana.api('POST', '/invites', {})
    expect((await ben.api('GET', '/invites')).json.invites.map((each: { id: string }) => each.id)).toEqual([
      bens.json.invite.id,
    ])
    expect((await ana.api('GET', '/invites')).json.invites).toHaveLength(2)
    expect((await ben.api('DELETE', `/invites/${anas.json.invite.id}`)).status).toBe(404)

    await setWhoCanInvite(ana, 'admins')
    expectRefused(await accept(codeOf(bens.json.url), 'friend@gmail.test'))
    const changed = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'organization.settings_changed',
    )
    expect(JSON.parse(String(changed.at(-1)!.detail))).toEqual({
      changed: ['whoCanInvite'],
      whoCanInvite: { from: 'members', to: 'admins' },
    })
  })

  it('are refused to an agent credential, which never makes or reads one', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const { code } = (await ana.api('POST', '/join-codes', {})).json
    const tokens = await server.request('POST', '/oauth/join', { form: { code, client_name: 'x' } })
    const token = tokens.json.access_token
    for (const [method, path] of [
      ['GET', '/api/v1/invites'],
      ['POST', '/api/v1/invites'],
      ['DELETE', '/api/v1/invites/any'],
    ] as const)
      expect((await server.request(method, path, { token, body: {} })).status).toBe(403)
    expect((await server.request('GET', '/api/v1/me', { token })).json.canInvite).toBe(false)
  })

  it('limit how many links one address may try', async () => {
    server = await startTestServer()
    for (let attempt = 0; attempt < 10; attempt++)
      expect((await server.request('POST', '/auth/invite', { form: { code: 'hbi_x' } })).status).toBe(302)
    expect((await server.request('POST', '/auth/invite', { form: { code: 'hbi_x' } })).status).toBe(429)
  })

  it('are switched off with the invites feature', async () => {
    server = await startTestServer({ HB_FEATURES: 'invites=off' })
    const ana = await server.signIn('ana@example.com', 'Ana')
    expect((await ana.api('POST', '/invites', {})).status).toBe(404)
    expect((await server.request('POST', '/auth/invite', { form: { code: 'hbi_x' } })).status).toBe(404)
    expect(ana.me.canInvite).toBe(false)
  })
})

describe('admission of existing members', () => {
  it('admits an active member after their domain is no longer allowed, and still refuses a deactivated one', async () => {
    server = await startTestServer({ HB_ALLOWED_DOMAINS: 'example.com,old.example' })
    const ana = await server.signIn('ana@example.com', 'Ana')
    const ben = await server.signIn('ben@old.example', 'Ben')
    await server.signIn('cy@old.example', 'Cy')
    const current = (await ana.api('GET', '/admin/settings')).json
    await ana.api('PUT', '/admin/settings', { ...current, allowedDomains: ['example.com'] })
    expect((await server.signIn('cy@old.example')).me.member.email).toBe('cy@old.example')
    await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { status: 'deactivated' })
    await expect(server.signIn('ben@old.example')).rejects.toThrow(/deactivated/)
    await expect(server.signIn('dee@old.example')).rejects.toThrow(/not\+allowed/)
  })
})

describe('invites through Google', () => {
  const CLIENT_ID = 'homingbird-client'
  let issuer: FakeIssuer

  const start = async (variables: Record<string, string>) => {
    issuer = makeFakeIssuer()
    server = await startTestServer(
      {
        HB_DEV_LOGIN: '0',
        HB_OIDC_ISSUER: issuer.issuer,
        HB_OIDC_CLIENT_ID: CLIENT_ID,
        HB_OIDC_CLIENT_SECRET: 'secret',
        HB_PUBLIC_URL: 'https://hb.example.com',
        ...variables,
      },
      { fetch: issuer.fetch },
    )
  }

  /** Signs in at the fake Google with these claims, from an invite link when given one. */
  const google = async (claims: Record<string, unknown>, code?: string) => {
    const started =
      code === undefined
        ? await server.request('GET', '/auth/login')
        : await server.request('POST', '/auth/invite', { form: { code } })
    if (started.headers.location!.startsWith('/#/')) return { location: started.headers.location! }
    const authorization = new URL(started.headers.location!)
    const nonce = authorization.searchParams.get('nonce')!
    issuer.nextToken = () =>
      issuer.signToken({
        iss: issuer.issuer,
        aud: CLIENT_ID,
        exp: Math.floor(server.clock.now() / 1000) + 300,
        iat: Math.floor(server.clock.now() / 1000),
        nonce,
        email_verified: true,
        ...claims,
      })
    const finished = await server.request(
      'GET',
      `/auth/callback?${new URLSearchParams({ code: Buffer.from(nonce).toString('base64url'), state: authorization.searchParams.get('state')! })}`,
    )
    const cookie = finished.headers['set-cookie']?.split(';')[0]
    return {
      location: finished.headers.location!,
      ...(cookie !== undefined && { cookie }),
    }
  }

  const sessionOf = (cookie: string): Session => ({
    cookie,
    token: cookie.slice(SESSION_COOKIE.length + 1),
    api: (method, path, body) =>
      server.request(method, `/api/v1${path}`, { cookie, ...(body !== undefined && { body }) }),
    me: null,
  })

  it('starts with no allowed domain and admits only the named administrators and invited people', async () => {
    await start({ HB_ADMIN_EMAILS: 'host@gmail.com' })
    const host = await google({ sub: 'host', email: 'host@gmail.com' })
    expect(host.cookie).toBeDefined()
    const stranger = await google({ sub: 'stranger', email: 'stranger@gmail.com' })
    expect(reasonOf(stranger.location).get('reason')).toMatch(/gmail\.com are not allowed/)

    const admin = sessionOf(host.cookie!)
    const code = codeOf((await admin.api('POST', '/invites', { email: 'friend@gmail.com' })).json.url)
    expect((await google({ sub: 'other', email: 'other@gmail.com' }, code)).location).toBe(
      '/#/invite-refused',
    )
    const friend = await google({ sub: 'friend', email: 'friend@gmail.com' }, code)
    expect(friend.cookie).toBeDefined()
    expect((await google({ sub: 'friend', email: 'friend@gmail.com' })).cookie).toBeDefined()
  })

  it('admits an invited personal account carrying a company address, without the hosted-domain check', async () => {
    await start({ HB_ADMIN_EMAILS: 'ana@example.com', HB_ALLOWED_DOMAINS: 'example.com' })
    const ana = sessionOf((await google({ sub: 'ana', email: 'ana@example.com', hd: 'example.com' })).cookie!)
    const personal = await google({ sub: 'ben-personal', email: 'ben@example.com' })
    expect(reasonOf(personal.location).get('reason')).toMatch(/organization account/)
    const code = codeOf((await ana.api('POST', '/invites', {})).json.url)
    expect((await google({ sub: 'ben-personal', email: 'ben@example.com' }, code)).cookie).toBeDefined()
  })

  it('refuses an unverified address even with a valid invite', async () => {
    await start({ HB_ADMIN_EMAILS: 'host@gmail.com' })
    const admin = sessionOf((await google({ sub: 'host', email: 'host@gmail.com' })).cookie!)
    const code = codeOf((await admin.api('POST', '/invites', {})).json.url)
    const unverified = await google({ sub: 'friend', email: 'friend@gmail.com', email_verified: false }, code)
    expect(reasonOf(unverified.location).get('reason')).toMatch(/not been verified/)
    expect((await admin.api('GET', '/invites')).json.invites).toHaveLength(1)
  })
})

describe('who may invite', () => {
  it.each([
    [{ role: 'admin', status: 'active', kind: 'person' }, 'admins', true],
    [{ role: 'member', status: 'active', kind: 'person' }, 'admins', false],
    [{ role: 'member', status: 'active', kind: 'person' }, 'members', true],
    [{ role: 'member', status: 'active', kind: 'person' }, 'unknown', false],
    [{ role: 'admin', status: 'deactivated', kind: 'person' }, 'members', false],
    [{ role: 'member', status: 'active', kind: 'channel_agent' }, 'members', false],
  ] as const)('decides %o under %s as %s', (member, whoCanInvite, expected) => {
    expect(mayInvite(member, { whoCanInvite })).toBe(expected)
  })
})
