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

afterEach(() => server?.close())

describe('the contact handlers', () => {
  it('request, accept and remove a contact, answering nothing for a removal', async () => {
    await ana.api('POST', '/contacts', { memberId: ben.me.member.id })
    await ben.api('POST', `/contacts/${ana.me.member.id}/accept`, {})
    expect((await ana.api('GET', '/contacts')).json.contacts.map((contact: any) => contact.state)).toEqual([
      'accepted',
    ])
    expect((await ana.api('DELETE', `/contacts/${ben.me.member.id}`)).json).toEqual({})
    expect((await ana.api('GET', '/contacts')).json.contacts).toEqual([])
  })

  it('block and unblock, answering nothing, and refuse an id that is not a member id', async () => {
    expect((await ana.api('PUT', `/blocks/${ben.me.member.id}`, {})).json).toEqual({})
    expect((await ana.api('DELETE', `/blocks/${ben.me.member.id}`)).json).toEqual({})
    expect((await ana.api('PUT', '/blocks/nobody', {})).status).toBe(400)
  })

  it('are a person’s own decision: an agent cannot change contacts or blocks', async () => {
    expect((await anaAgent.api('PUT', `/blocks/${ben.me.member.id}`, {})).status).toBe(403)
    expect((await anaAgent.api('POST', '/contacts', { memberId: ben.me.member.id })).status).toBe(403)
  })
})
