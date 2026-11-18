import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, connectAgent, startTestServer, storedRows } from './harness.ts'

const DAY = 24 * 60 * 60_000

let server: TestServer
let ana: Session
let ben: Session

beforeEach(async () => {
  server = await startTestServer({ HB_SESSION_DAYS: '30', HB_AGENT_CREDENTIAL_DAYS: '90' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
})

afterEach(() => server.close())

describe('credentials', () => {
  it('lists each device with its kind, name, client and expiry, marking the current one', async () => {
    await connectAgent(server, ana, { name: 'Laptop agent' })
    const { credentials } = (await ana.api('GET', '/credentials')).json
    expect(
      credentials
        .map((c: any) => [c.kind, c.name, c.client, c.current, c.revokedAt])
        .sort((a: any, b: any) => a[1].localeCompare(b[1])),
    ).toEqual([
      ['human', 'Browser', 'Web', true, null],
      ['agent', 'Laptop agent', 'Laptop agent', false, null],
    ])
    for (const credential of credentials) expect(credential.expiresAt).toBeGreaterThan(credential.createdAt)
    expect((await ben.api('GET', '/credentials')).json.credentials).toHaveLength(1)
  })

  it('expires a browser session after the configured days and an agent credential after its own', async () => {
    const agent = await connectAgent(server, ana)
    await server.clock.advance(30 * DAY - 1)
    expect((await ana.api('GET', '/me')).status).toBe(200)
    await server.clock.advance(1)
    expect((await ana.api('GET', '/me')).status).toBe(401)
    expect((await agent.api('GET', '/me')).status).toBe(200)
    await server.clock.advance(60 * DAY)
    expect((await agent.api('GET', '/me')).status).toBe(401)
  })

  it('lets the owner rename and revoke a credential, and nobody else', async () => {
    const agent = await connectAgent(server, ana, { name: 'Old name' })
    const id = (await agent.api('GET', '/me')).json.credential.id
    expect((await ben.api('PATCH', `/credentials/${id}`, { name: 'stolen' })).status).toBe(404)
    expect((await ben.api('DELETE', `/credentials/${id}`)).status).toBe(404)
    expect((await ana.api('PATCH', `/credentials/${id}`, { name: 'New name' })).json.name).toBe('New name')
    expect((await agent.api('GET', '/me')).json.credential.name).toBe('New name')
    expect((await ana.api('DELETE', `/credentials/${id}`)).status).toBe(200)
    expect((await agent.api('GET', '/me')).status).toBe(401)
    const listed = (await ana.api('GET', '/credentials')).json.credentials.find((c: any) => c.id === id)
    expect(listed.revokedAt).toBe(server.clock.now())
  })

  it('refuses a malformed or unknown bearer token', async () => {
    expect((await server.request('GET', '/api/v1/me', { token: 'hba_notarealtoken' })).status).toBe(401)
    expect((await server.request('GET', '/api/v1/me')).status).toBe(401)
    expect(
      (await server.request('GET', '/api/v1/me', { headers: { authorization: 'Basic abc' } })).status,
    ).toBe(401)
  })

  it('updates last use at most once a minute', async () => {
    const lastUsed = async () =>
      (await storedRows(server, 'credentials')).find((row) => row.id === ana.me.credential.id)!.last_used_at
    const first = await lastUsed()
    await server.clock.advance(59_000)
    await ana.api('GET', '/me')
    expect(await lastUsed()).toBe(first)
    await server.clock.advance(2_000)
    await ana.api('GET', '/me')
    expect(await lastUsed()).toBe(server.clock.now())
  })

  it('signs a browser out and forgets the session', async () => {
    const out = await server.request('POST', '/auth/logout', { cookie: ana.cookie })
    expect(out.status).toBe(204)
    expect(out.headers['set-cookie']).toContain('Max-Age=0')
    expect((await ana.api('GET', '/me')).status).toBe(401)
    expect((await server.request('POST', '/auth/logout')).status).toBe(204)
  })
})

describe('cookie sessions', () => {
  it('refuses a state-changing request that lacks the web client header or comes from another origin', async () => {
    const path = '/api/v1/me'
    const body = { profile: 'x' }
    const bare = await server.request('PATCH', path, { headers: { cookie: ana.cookie }, body })
    expect(bare.status).toBe(403)
    const foreign = await server.request('PATCH', path, {
      cookie: ana.cookie,
      headers: { origin: 'https://evil.example' },
      body,
    })
    expect(foreign.status).toBe(403)
    const own = await server.request('PATCH', path, {
      cookie: ana.cookie,
      headers: { origin: 'http://localhost:8080' },
      body,
    })
    expect(own.status).toBe(200)
    expect((await server.request('GET', path, { headers: { cookie: ana.cookie } })).status).toBe(200)
  })
})

describe('administration', () => {
  it('makes the first member an admin and keeps admin routes from everyone else', async () => {
    expect(ana.me.member.role).toBe('admin')
    expect(ben.me.member.role).toBe('member')
    expect((await ben.api('GET', '/admin/settings')).status).toBe(403)
    expect((await ben.api('GET', '/admin/audit')).status).toBe(403)
    expect((await ana.api('GET', '/admin/members')).json.members).toHaveLength(2)
  })

  it('deactivating a member revokes every credential at once and hides them from the directory', async () => {
    const agent = await connectAgent(server, ben)
    const updated = await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { status: 'deactivated' })
    expect(updated.json.status).toBe('deactivated')
    expect((await ben.api('GET', '/me')).status).toBe(401)
    expect((await agent.api('GET', '/me')).status).toBe(401)
    const entries = (await ana.api('GET', '/directory')).json.entries
    expect(entries.map((entry: any) => entry.member.email)).toEqual(['ana@example.com'])
    expect((await ana.api('POST', '/drafts', { to: [ben.me.member.id], body: 'gone' })).status).toBe(403)
    await expect(server.signIn('ben@example.com')).rejects.toThrow(/deactivated/)
    await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { status: 'active' })
    expect((await server.signIn('ben@example.com')).me.member.status).toBe('active')
  })

  it('promotes a member, and stops admins from changing themselves', async () => {
    expect((await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { role: 'admin' })).json.role).toBe(
      'admin',
    )
    expect((await ben.api('GET', '/admin/settings')).status).toBe(200)
    expect((await ana.api('PATCH', `/admin/members/${ana.me.member.id}`, { role: 'member' })).status).toBe(
      409,
    )
    expect((await ana.api('PATCH', '/admin/members/mem_doesnotexist00', { role: 'admin' })).status).toBe(404)
  })

  it('changes allowed domains and contact mode at run time', async () => {
    const initial = (await ana.api('GET', '/admin/settings')).json
    expect(initial).toEqual({
      allowedDomains: ['example.com'],
      contactMode: 'open',
      auditRetentionDays: null,
      answeringFlow: null,
    })
    const next = {
      allowedDomains: ['example.com', 'partner.org'],
      contactMode: 'contacts',
      auditRetentionDays: 30,
    }
    expect((await ana.api('PUT', '/admin/settings', next)).json).toEqual({ ...next, answeringFlow: null })
    expect((await ben.api('GET', '/me')).json.contactMode).toBe('contacts')
    expect((await server.request('GET', '/api/v1/info')).json).toMatchObject({
      name: 'dovecote',
      contactMode: 'contacts',
    })
    expect((await server.signIn('dee@partner.org')).me.member.email).toBe('dee@partner.org')
    expect(
      (await ana.api('PUT', '/admin/settings', { ...next, allowedDomains: ['Not A Domain'] })).status,
    ).toBe(400)
  })

  it('keeps the answering flow an administrator sets, checks its format, and leaves it alone when a change omits it', async () => {
    const FLOW = [
      '## Before drafting',
      '1. Look for an existing answer in the organization’s knowledge base.',
      '## Check the draft',
      '- Nothing confidential or secret leaves the organization.',
      '- The tone is polite and direct.',
    ].join('\n')
    const base = (await ana.api('GET', '/admin/settings')).json
    const benAgent = await connectAgent(server, ben)
    expect((await ben.api('GET', '/answering-flow')).json).toEqual({ flow: null, updatedAt: null })
    await server.clock.advance(1_000)
    expect(
      (await ana.api('PUT', '/admin/settings', { ...base, answeringFlow: `  ${FLOW}\n` })).json,
    ).toMatchObject({
      answeringFlow: FLOW,
    })
    const read = (await benAgent.api('GET', '/answering-flow')).json
    expect(read).toEqual({ flow: FLOW, updatedAt: 1_700_000_001_000 })
    await server.clock.advance(1_000)
    await ana.api('PUT', '/admin/settings', { ...base, contactMode: 'contacts', answeringFlow: undefined })
    expect((await ben.api('GET', '/answering-flow')).json).toEqual(read)
    await ana.api('PUT', '/admin/settings', { ...base, answeringFlow: FLOW })
    expect((await ben.api('GET', '/answering-flow')).json.updatedAt).toBe(1_700_000_001_000)

    const refused = await ana.api('PUT', '/admin/settings', { ...base, answeringFlow: 'Just look it up.' })
    expect([refused.status, refused.json.error.message]).toEqual([
      400,
      'Write each step as an item of a numbered or bulleted list, such as "1. Look the question up in the wiki."',
    ])
    expect(
      (await ana.api('PUT', '/admin/settings', { ...base, answeringFlow: 'x'.repeat(4_001) })).status,
    ).toBe(400)
    expect((await ben.api('GET', '/answering-flow')).json.flow).toBe(FLOW)

    await server.clock.advance(1_000)
    await ana.api('PUT', '/admin/settings', { ...base, answeringFlow: '   ' })
    expect((await ben.api('GET', '/answering-flow')).json).toEqual({
      flow: null,
      updatedAt: 1_700_000_003_000,
    })
  })

  it('lets only an administrator set the answering flow, never an agent, and audits the change', async () => {
    const base = (await ana.api('GET', '/admin/settings')).json
    const flow = '1. Answer in two sentences.'
    const anaAgent = await connectAgent(server, ana)
    expect((await ben.api('PUT', '/admin/settings', { ...base, answeringFlow: flow })).status).toBe(403)
    expect((await anaAgent.api('PUT', '/admin/settings', { ...base, answeringFlow: flow })).status).toBe(403)
    expect((await ben.api('GET', '/answering-flow')).json.flow).toBeNull()
    await ana.api('PUT', '/admin/settings', { ...base, answeringFlow: flow })
    const audited = (await ana.api('GET', '/admin/audit?action=admin.settings.put')).json.entries
    expect(audited[0].detail.request.answeringFlow).toBe(flow)
    expect((await server.request('GET', '/api/v1/info')).json).not.toHaveProperty('answeringFlow')
  })
})

describe('profile and directory', () => {
  it('lets a person edit their name and what their agent can help with, and search finds it', async () => {
    const updated = (await ben.api('PATCH', '/me', { name: 'Benjamin', profile: 'Billing and invoices' }))
      .json
    expect(updated).toMatchObject({ name: 'Benjamin', profile: 'Billing and invoices' })
    const found = (await ana.api('GET', '/directory?q=INVOICE')).json.entries
    expect(found.map((entry: any) => entry.member.name)).toEqual(['Benjamin'])
    expect((await ana.api('GET', '/directory?q=nobody')).json.entries).toEqual([])
    expect((await ben.api('PATCH', '/me', { profile: 'x'.repeat(501) })).status).toBe(400)
  })

  it('reports people and agents online separately, once the change is announced', async () => {
    const agent = await connectAgent(server, ben)
    const presenceOf = async () =>
      (await ana.api('GET', '/directory')).json.entries.find((e: any) => e.member.id === ben.me.member.id)
        .presence
    expect(await presenceOf()).toEqual({ humanOnline: false, agentOnline: false })
    const hangUp = new AbortController()
    const stream = await server.request('GET', '/api/v1/events/stream', {
      token: agent.token,
      signal: hangUp.signal,
    })
    expect(stream.status).toBe(200)
    expect(await presenceOf()).toEqual({ humanOnline: false, agentOnline: true })
    hangUp.abort()
    expect(await presenceOf()).toEqual({ humanOnline: false, agentOnline: false })
  })
})
