import { afterEach, describe, expect, it } from 'vitest'
import { JOIN_CODE_REFUSED } from '../src/auth/join-codes.ts'
import { CHANNEL, startAgent, startWithChannel } from './channel-agent-support.ts'
import { type TestServer, connectAgent, everyStoredValue, startTestServer, storedRows } from './harness.ts'

let server: TestServer
afterEach(() => server.close())

const redeem = (code: string, form: Record<string, string> = {}) =>
  server.request('POST', '/oauth/join', {
    form: { code, client_name: 'build-1', client_kind: 'cli', ...form },
  })

const refused = { error: 'invalid_grant', error_description: JOIN_CODE_REFUSED }

describe('join codes', () => {
  it('issue the person who made one an agent credential, once, from a code shown only in its response', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const created = await ana.api('POST', '/join-codes', {})
    expect(created.status).toBe(200)
    expect(created.json).toEqual({
      code: expect.stringMatching(/^hbj_[A-Za-z0-9_-]{43}$/),
      serverUrl: 'http://localhost:8080',
      expiresAt: server.clock.now() + 600_000,
    })
    const code: string = created.json.code
    expect(await everyStoredValue(server)).not.toContain(code.slice(4))
    expect(server.logged.join('\n')).not.toContain(code.slice(4))

    const tokens = await redeem(code)
    expect(tokens.status).toBe(200)
    expect(tokens.json.access_token).toMatch(/^hba_/)
    expect(Object.keys(tokens.json).sort()).toEqual(['access_token', 'expires_in', 'scope', 'token_type'])
    const me = await server.request('GET', '/api/v1/me', { token: tokens.json.access_token })
    expect(me.json.member.id).toBe(ana.me.member.id)
    const credential = (await ana.api('GET', '/credentials')).json.credentials.find(
      (each: { kind: string }) => each.kind === 'agent',
    )
    expect(credential).toMatchObject({ name: 'build-1', client: 'build-1', kind: 'agent' })
    expect(credential.expiresAt).toBe(server.clock.now() + server.env.config.agentCredentialDays * 86_400_000)

    const again = await redeem(code)
    expect(again.status).toBe(400)
    expect(again.json).toEqual(refused)
  })

  it('are audited by member and credential id, never by the code', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const { code } = (await ana.api('POST', '/join-codes', {})).json
    await redeem(code)
    const audited = (await storedRows(server, 'audit_events')).filter((row) =>
      ['credential.join_code_created', 'credential.issued'].includes(String(row.event)),
    )
    expect(audited.slice(-2).map((row) => [row.event, row.actor_id, row.target_kind])).toEqual([
      ['credential.join_code_created', ana.me.member.id, 'member'],
      ['credential.issued', ana.me.member.id, 'credential'],
    ])
    expect(audited.at(-2)!.target_id).toBe(ana.me.member.id)
    expect(JSON.parse(String(audited.at(-1)!.detail))).toEqual({
      kind: 'agent',
      grant: 'join_code',
      clientKind: 'cli',
    })
    expect(JSON.stringify(audited)).not.toContain(code.slice(4))
  })

  it('refuse, all alike, an expired code, an unknown one and one whose creator was deactivated', async () => {
    const started = await startWithChannel()
    server = started.server
    const { root, ana } = started
    const expired = (await ana.api('POST', '/join-codes', {})).json.code
    await server.clock.advance(600_000)
    expect((await redeem(expired)).json).toEqual(refused)
    expect((await redeem('hbj_unknown')).json).toEqual(refused)
    expect((await redeem('not-a-join-code')).json).toEqual(refused)

    const pending = (await ana.api('POST', '/join-codes', {})).json.code
    await root.api('PATCH', `/admin/members/${ana.me.member.id}`, { status: 'deactivated' })
    expect((await redeem(pending)).json).toEqual(refused)
  })

  it('are made by people in the web client only, never by an agent credential', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const agent = await connectAgent(server, ana)
    expect((await agent.api('POST', '/join-codes', {})).status).toBe(403)
  })

  it('issue a channel’s agent its credential when one of its managers makes the code', async () => {
    const started = await startWithChannel()
    server = started.server
    const { ana, ben } = started
    const agent = await startAgent(server, ana)
    expect((await ben.api('POST', '/join-codes', { channel: CHANNEL })).status).toBe(403)
    const { code } = (await ana.api('POST', '/join-codes', { channel: CHANNEL })).json
    const tokens = (await redeem(code)).json
    const me = await server.request('GET', '/api/v1/me', { token: tokens.access_token })
    expect(me.json.member.id).toBe(agent.id)
    const desks = (await ana.api('GET', `/channels/${CHANNEL}/agent`)).json.credentials
    expect(desks.find((desk: { name: string }) => desk.name === 'build-1').issuedBy).toBe(ana.me.member.id)
    const issued = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'credential.issued',
    )
    expect(JSON.parse(String(issued.at(-1)!.detail))).toMatchObject({
      grant: 'join_code',
      channelAgent: agent.id,
    })
  })

  it('refuse a channel’s code once its creator no longer manages the channel', async () => {
    const started = await startWithChannel()
    server = started.server
    const { ana, ben } = started
    await startAgent(server, ana)
    const { code } = (await ana.api('POST', '/join-codes', { channel: CHANNEL })).json
    const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
    await ana.api('PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id, ben.me.member.id] })
    await ben.api('PUT', `/groups/${group}/members`, { memberIds: [ben.me.member.id] })
    expect((await redeem(code)).json).toEqual(refused)
  })

  it('answer 404 while the feature is off, and refuse a channel code while channel agents are off', async () => {
    server = await startTestServer({ HB_FEATURES: 'joinCodes=off' })
    const ana = await server.signIn('ana@example.com', 'Ana')
    expect((await ana.api('POST', '/join-codes', {})).status).toBe(404)
    expect((await redeem('hbj_anything')).status).toBe(404)
    await server.close()

    server = await startTestServer()
    const ben = await server.signIn('ben@example.com', 'Ben')
    expect((await ben.api('POST', '/join-codes', { channel: CHANNEL })).status).toBe(404)
  })

  it('limit how often one address may try to redeem one', async () => {
    server = await startTestServer()
    for (let attempt = 0; attempt < 10; attempt++) expect((await redeem('hbj_guess')).status).toBe(400)
    expect((await redeem('hbj_guess')).status).toBe(429)
    await server.clock.advance(600_000)
    expect((await redeem('hbj_guess')).status).toBe(400)
  })
})
