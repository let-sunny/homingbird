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

describe('the channel handlers', () => {
  it('page the channel list by cursor, keeping the page size between 1 and 200', async () => {
    for (const slug of ['a-room', 'b-room', 'c-room'])
      await ana.api('POST', '/channels', { slug, description: slug })
    const first = (await ben.api('GET', '/channels?limit=2')).json
    expect(first.channels.map((channel: any) => channel.slug)).toEqual(['a-room', 'b-room'])
    const rest = (await ben.api('GET', '/channels?limit=2&cursor=2')).json
    expect(rest.channels.map((channel: any) => channel.slug)).toEqual(['c-room'])
    expect((await ben.api('GET', '/channels?limit=0')).json.channels).toHaveLength(1)
  })

  it('join a channel as a helper when asked, and leave it', async () => {
    await ana.api('POST', '/channels', { slug: 'billing', description: 'Billing' })
    expect((await ben.api('PUT', '/channels/billing/membership', { answering: true })).json).toMatchObject({
      slug: 'billing',
    })
    const members = (await ana.api('GET', '/channels/billing/members')).json.members
    expect(members.find((member: any) => member.memberId === ben.me.member.id)).toMatchObject({
      answering: true,
    })
    await ben.api('DELETE', '/channels/billing/membership')
    expect((await ana.api('GET', '/channels/billing/members')).json.members).toHaveLength(1)
  })

  it('refuse a member id that is not one before adding or removing anyone', async () => {
    await ana.api('POST', '/channels', { slug: 'billing', description: 'Billing', visibility: 'private' })
    expect((await ana.api('PUT', '/channels/billing/members/nobody', {})).status).toBe(400)
    expect((await ana.api('DELETE', '/channels/billing/members/nobody')).status).toBe(400)
    expect((await ana.api('PUT', `/channels/billing/members/${ben.me.member.id}`, {})).status).toBe(200)
  })
})
