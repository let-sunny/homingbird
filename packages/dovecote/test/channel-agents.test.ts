import { afterEach, describe, expect, it } from 'vitest'
import {
  CHANNEL,
  asRead,
  askAndDraft,
  issueAgentCredential,
  startAgent,
  startWithChannel,
} from './channel-agent-support.ts'
import { type Session, type TestServer, storedRows } from './harness.ts'

let server: TestServer
let root: Session
let ana: Session
let ben: Session
let cy: Session

const start = async (overrides: Readonly<Record<string, string>> = {}) => {
  ;({ server, root, ana, ben, cy } = await startWithChannel(overrides))
}

afterEach(async () => {
  await server?.close()
})

const auditEvents = async (event: string) =>
  (await storedRows(server, 'audit_events'))
    .filter((row) => row.event === event)
    .map((row) => ({ actor: row.actor_id, target: row.target_id, detail: JSON.parse(String(row.detail)) }))

describe('a channel’s agent', () => {
  it('is shown on its channel as awake while its desk runs, and unable to answer when it cannot', async () => {
    await start()
    const agent = await startAgent(server, ana)
    const stream = new AbortController()
    server.env.hub.subscribe(agent.id as never, 'agent', stream.signal)
    expect((await cy.api('GET', `/channels/${CHANNEL}`)).json.agent.presence).toEqual({
      humanOnline: false,
      agentOnline: true,
    })
    server.env.hub.markUnavailable(agent.id as never, { kind: 'usage_limit', until: 9 })
    expect((await cy.api('GET', `/channels/${CHANNEL}`)).json.agent.presence.agentUnavailable).toEqual({
      until: 9,
    })
    expect((await ana.api('GET', `/channels/${CHANNEL}`)).json.agent.presence.agentUnavailable).toEqual({
      until: 9,
      kind: 'usage_limit',
    })
    stream.abort()
    expect((await cy.api('GET', `/channels/${CHANNEL}`)).json.agent.presence.agentOnline).toBe(false)
  })

  it('is a member of its own kind in the channel’s room, shown on the channel and listed apart from people', async () => {
    await start()
    const made = await ana.api('PUT', `/channels/${CHANNEL}/agent`, { name: 'Payments wiki' })
    expect(made.status).toBe(200)
    expect(made.json).toMatchObject({
      agent: { name: 'Payments wiki', kind: 'channel_agent', status: 'active', role: 'member' },
      channel: CHANNEL,
      credentials: [],
    })
    const agentId = made.json.agent.id
    expect(made.json.agent.email).toBe(`${agentId}@agents.invalid`)
    expect((await cy.api('GET', `/channels/${CHANNEL}`)).json.agent).toEqual({
      id: agentId,
      name: 'Payments wiki',
      presence: { humanOnline: false, agentOnline: false },
    })
    expect((await cy.api('GET', `/channels/${CHANNEL}`)).json.memberCount).toBe(3)
    expect((await ana.api('GET', `/channels/${CHANNEL}`)).json.runsAgent).toBe(true)
    expect((await cy.api('GET', `/channels/${CHANNEL}`)).json.runsAgent).toBe(false)
    expect((await root.api('GET', `/channels/${CHANNEL}`)).json).toMatchObject({
      managing: true,
      runsAgent: false,
    })
    const room = (await cy.api('GET', `/channels/${CHANNEL}/members`)).json.members.map(
      (one: any) => one.memberId,
    )
    expect(room).not.toContain(agentId)
    const directory = (await cy.api('GET', '/directory')).json.entries.map((entry: any) => entry.member.id)
    expect(directory).not.toContain(agentId)
    const listed = (await root.api('GET', '/admin/members')).json
    expect(listed.members.map((member: any) => member.id)).not.toContain(agentId)
    expect(listed.agents).toEqual([{ member: made.json.agent, channel: CHANNEL }])
    expect(await auditEvents('channel.agent_created')).toEqual([
      { actor: ana.me.member.id, target: agentId, detail: { channel: CHANNEL } },
    ])
  })

  it('is made, named and retired only by a manager in the room, never by an administrator outside its group', async () => {
    await start()
    expect((await root.api('PUT', `/channels/${CHANNEL}/agent`, { name: 'Mine' })).status).toBe(403)
    expect((await cy.api('PUT', `/channels/${CHANNEL}/agent`, { name: 'Mine' })).status).toBe(403)
    await ana.api('PUT', `/channels/${CHANNEL}/agent`, { name: 'Payments wiki' })
    expect((await ana.api('PUT', `/channels/${CHANNEL}/agent`, { name: 'Again' })).status).toBe(409)
    expect((await cy.api('GET', `/channels/${CHANNEL}/agent`)).status).toBe(403)
    expect((await cy.api('DELETE', `/channels/${CHANNEL}/agent`)).status).toBe(403)
    const renamed = await ana.api('PATCH', `/channels/${CHANNEL}/agent`, { name: 'Refunds wiki' })
    expect(renamed.json.agent.name).toBe('Refunds wiki')
    expect((await ana.api('PATCH', `/channels/${CHANNEL}/agent`, { name: 'two\nlines' })).status).toBe(400)
  })

  it('answers 404 to every agent route while channel agents are off, and shows no agent on a channel', async () => {
    await start({ HB_FEATURES: 'channelAgents=off' })
    expect((await ana.api('PUT', `/channels/${CHANNEL}/agent`, { name: 'Payments wiki' })).status).toBe(404)
    expect((await ana.api('GET', '/reviews')).status).toBe(404)
    expect((await ana.api('POST', `/channels/${CHANNEL}/private-question`)).status).toBe(404)
    expect((await ana.api('GET', `/channels/${CHANNEL}`)).json.agent).toBeNull()
  })

  it('refuses every agent route to an agent credential', async () => {
    await start()
    const agent = await startAgent(server, ana)
    expect((await agent.api('GET', `/channels/${CHANNEL}/agent`)).status).toBe(403)
    expect((await agent.api('GET', '/reviews')).status).toBe(403)
    expect((await agent.api('POST', `/channels/${CHANNEL}/private-question`)).status).toBe(403)
  })
})

describe('an agent’s credentials', () => {
  it('are issued by a manager in the room through the device flow, recorded with their issuer', async () => {
    await start()
    const agent = await startAgent(server, ana)
    const me = (await agent.api('GET', '/me')).json
    expect(me.member).toMatchObject({ id: agent.id, kind: 'channel_agent' })
    expect(me.credential.kind).toBe('agent')
    const view = (await ana.api('GET', `/channels/${CHANNEL}/agent`)).json
    expect(view.credentials).toMatchObject([
      { name: 'Wiki desk', issuedBy: ana.me.member.id, revokedAt: null },
    ])
    const [issued] = await auditEvents('credential.issued').then((rows) =>
      rows.filter((row) => row.detail.channelAgent !== undefined),
    )
    expect(issued).toMatchObject({
      actor: ana.me.member.id,
      detail: { channelAgent: agent.id, kind: 'agent' },
    })
  })

  it('are refused to a person who does not manage the channel, and to a channel with no agent', async () => {
    await start()
    await expect(issueAgentCredential(server, cy)).rejects.toThrow(/403/)
    await expect(issueAgentCredential(server, ana)).rejects.toThrow(/404/)
  })

  it('go when their issuer stops managing the channel, in the same change, and stay for another manager', async () => {
    await start()
    const anas = await startAgent(server, ana)
    const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
    await ana.api('PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id, ben.me.member.id] })
    const bens = await issueAgentCredential(server, ben)
    await ben.api('PUT', `/groups/${group}/members`, { memberIds: [ben.me.member.id] })
    expect((await anas.api('GET', '/me')).status).toBe(401)
    expect((await bens.api('GET', '/me')).status).toBe(200)
    expect((await auditEvents('credential.revoked')).map((row) => row.detail)).toEqual([
      { because: 'issuer_left' },
    ])
  })

  it('go when their issuer is deactivated', async () => {
    await start()
    const agent = await startAgent(server, ana)
    const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
    await ana.api('PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id, ben.me.member.id] })
    await root.api('PATCH', `/admin/members/${ana.me.member.id}`, { status: 'deactivated' })
    expect((await agent.api('GET', '/me')).status).toBe(401)
  })

  it('leave nothing of a deactivated issuer that the offboarding checks in the deployment guide look for', async () => {
    await start()
    await startAgent(server, ana)
    const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
    await ana.api('PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id, ben.me.member.id] })
    const id = ana.me.member.id
    const live = async () => ({
      own: (await storedRows(server, 'credentials')).filter(
        (row) => row.member_id === id && row.revoked_at === null,
      ),
      issued: (await storedRows(server, 'credentials')).filter(
        (row) => row.issued_by === id && row.revoked_at === null,
      ),
      groups: (await storedRows(server, 'group_members')).filter((row) => row.member_id === id),
    })
    const before = await live()
    expect([before.own.length, before.issued.length, before.groups.length].every((count) => count > 0)).toBe(
      true,
    )
    await root.api('PATCH', `/admin/members/${id}`, { status: 'deactivated' })
    expect(await live()).toEqual({ own: [], issued: [], groups: [] })
  })

  it('may be revoked by any manager, and only one of this agent’s', async () => {
    await start()
    const agent = await startAgent(server, ana)
    const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
    await ana.api('PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id, ben.me.member.id] })
    const [credential] = (await ben.api('GET', `/channels/${CHANNEL}/agent`)).json.credentials
    expect(
      (await ben.api('DELETE', `/channels/${CHANNEL}/agent/credentials/cred_unknown000000`)).status,
    ).toBe(404)
    expect((await cy.api('DELETE', `/channels/${CHANNEL}/agent/credentials/${credential.id}`)).status).toBe(
      403,
    )
    const revoked = await ben.api('DELETE', `/channels/${CHANNEL}/agent/credentials/${credential.id}`)
    expect(revoked.json.credentials[0].revokedAt).not.toBeNull()
    expect((await agent.api('GET', '/me')).status).toBe(401)
  })

  it('stop working while channel agents are off, and work again when they are on', async () => {
    await start()
    const agent = await startAgent(server, ana)
    const settings = (await root.api('GET', '/admin/settings')).json
    await root.api('PUT', '/admin/settings', { ...settings, features: { channelAgents: false } })
    expect((await agent.api('GET', '/me')).status).toBe(401)
    await root.api('PUT', '/admin/settings', { ...settings, features: { channelAgents: true } })
    expect((await agent.api('GET', '/me')).status).toBe(200)
  })

  it('are refused when the person who approved them no longer manages the channel by the time they are fetched', async () => {
    await start()
    await ana.api('PUT', `/channels/${CHANNEL}/agent`, { name: 'Payments wiki' })
    const group = (await ana.api('GET', `/channels/${CHANNEL}`)).json.managedBy
    await ana.api('PUT', `/groups/${group}/members`, { memberIds: [ana.me.member.id, ben.me.member.id] })
    const started = await server.request('POST', '/oauth/device_authorization', {
      form: { client_name: 'Wiki desk', scope: 'notes' },
    })
    await ana.api('POST', `/device/${started.json.user_code}`, { approve: true, channel: CHANNEL })
    await ben.api('PUT', `/groups/${group}/members`, { memberIds: [ben.me.member.id] })
    const tokens = await server.request('POST', '/oauth/token', {
      form: {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: started.json.device_code,
      },
    })
    expect(tokens.json.error).toBe('invalid_grant')
  })
})

describe('signing in as a channel’s agent', () => {
  it('is refused, even with the agent’s own address, and changes nothing about the agent', async () => {
    await start({ HB_ALLOWED_DOMAINS: 'example.com,agents.invalid' })
    const made = (await ana.api('PUT', `/channels/${CHANNEL}/agent`, { name: 'Payments wiki' })).json
    await expect(server.signIn(made.agent.email, 'Me')).rejects.toThrow(/sign-in refused/)
    expect((await ana.api('GET', `/channels/${CHANNEL}/agent`)).json.agent).toEqual(made.agent)
  })
})

describe('retiring a channel’s agent', () => {
  it('deactivates it, revokes its credentials and discards its waiting answers, and lets the managers make another', async () => {
    await start()
    const agent = await startAgent(server, ana)
    const { draft } = await askAndDraft(cy, agent)
    expect((await ana.api('DELETE', `/channels/${CHANNEL}/agent`)).status).toBe(200)
    expect((await agent.api('GET', '/me')).status).toBe(401)
    expect((await ana.api('GET', '/reviews')).json.reviews).toEqual([])
    expect((await storedRows(server, 'notes')).find((row) => row.id === draft.id)?.status).toBe('discarded')
    expect((await ana.api('GET', `/channels/${CHANNEL}`)).json.agent).toBeNull()
    expect((await auditEvents('channel.agent_retired')).map((row) => row.target)).toEqual([agent.id])
    const next = await ana.api('PUT', `/channels/${CHANNEL}/agent`, { name: 'Payments wiki 2' })
    expect(next.status).toBe(200)
    expect((await root.api('GET', '/admin/members')).json.agents).toMatchObject([
      { member: { id: agent.id, status: 'deactivated' }, channel: null },
      { member: { id: next.json.agent.id, status: 'active' }, channel: CHANNEL },
    ])
  })

  it('happens first when the channel is archived, so the agent never moves with its members', async () => {
    await start()
    const agent = await startAgent(server, ana)
    await ana.api('POST', '/channels', { slug: 'payments', description: 'Payments' })
    await cy.api('PUT', '/channels/payments/membership', {})
    await ben.api('PUT', '/channels/payments/membership', {})
    const { draft } = await askAndDraft(cy, agent)
    const archived = await root.api('POST', `/admin/channels/${CHANNEL}/archive`, {
      moveMembersTo: 'payments',
    })
    expect(archived.status).toBe(200)
    expect((await agent.api('GET', '/me')).status).toBe(401)
    expect((await ana.api('GET', '/channels/payments')).json).toMatchObject({ memberCount: 3, agent: null })
    expect((await storedRows(server, 'notes')).find((row) => row.id === draft.id)?.status).toBe('discarded')
    expect(await auditEvents('channel.agent_retired')).toEqual([
      {
        actor: root.me.member.id,
        target: agent.id,
        detail: { channel: CHANNEL, because: 'channel_archived' },
      },
    ])
  })
})

describe('a manager answering the question themself', () => {
  it('still sends their own reply from their own draft, unaffected by the agent', async () => {
    await start()
    const agent = await startAgent(server, ana)
    const { question } = await askAndDraft(cy, agent)
    const reply = (await ana.api('POST', '/drafts', { inReplyTo: question.id, body: 'Here it is.' })).json
    const sent = await ana.api('POST', `/drafts/${reply.id}/send`, { expected: asRead(reply) })
    expect(sent.json).toMatchObject({ status: 'sent', authorId: ana.me.member.id })
    expect(sent.json.approvedBy).toBeUndefined()
  })
})
