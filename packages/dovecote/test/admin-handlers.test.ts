import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let anaAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
})

afterEach(() => server.close())

describe('the administration handlers', () => {
  it('list every member, and change one only by a valid id', async () => {
    const members = (await ana.api('GET', '/admin/members')).json.members
    expect(members.map((member: any) => member.name).sort()).toEqual(['Ana', 'Ben'])
    expect((await ana.api('PATCH', '/admin/members/not-an-id', { role: 'admin' })).status).toBe(400)
    expect((await ana.api('PATCH', `/admin/members/${ben.me.member.id}`, { role: 'admin' })).json.role).toBe(
      'admin',
    )
  })

  it('are for administrators only, never for an agent or a member', async () => {
    expect((await anaAgent.api('GET', '/admin/members')).status).toBe(403)
    expect((await ben.api('GET', '/admin/insights')).status).toBe(403)
    expect((await ana.api('GET', '/admin/insights')).status).toBe(200)
  })

  it('archive a channel and answer nothing more', async () => {
    await ana.api('POST', '/channels', { slug: 'billing', description: 'Billing' })
    expect((await ana.api('POST', '/admin/channels/billing/archive', {})).json).toEqual({})
    expect((await ana.api('GET', '/channels/billing')).json.archivedAt).not.toBeNull()
  })
})
