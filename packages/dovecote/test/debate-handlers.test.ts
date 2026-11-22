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

describe('the debate handlers', () => {
  it('open a room, list it, and show it by a valid id only', async () => {
    const room = (await ana.api('POST', '/debates', { question: 'Which plan holds up?' })).json
    expect(room).toMatchObject({ question: 'Which plan holds up?', status: 'open' })
    expect((await ben.api('GET', '/debates')).json.debates.map((debate: any) => debate.id)).toEqual([room.id])
    expect((await ben.api('GET', `/debates/${room.id}`)).json.id).toBe(room.id)
    expect((await ben.api('GET', '/debates/not-an-id')).status).toBe(400)
  })

  it('answer a person and an agent what waits for them, in the same shape', async () => {
    await ana.api('POST', '/debates', { question: 'Which plan holds up?' })
    for (const caller of [ana, anaAgent])
      expect(Object.keys((await caller.api('GET', '/debate-asks')).json).sort()).toEqual([
        'asks',
        'ballots',
        'ended',
      ])
  })

  it('leave opening a room and opting an agent in to a person', async () => {
    expect((await anaAgent.api('POST', '/debates', { question: 'Mine?' })).status).toBe(403)
    const room = (await ana.api('POST', '/debates', { question: 'Which plan holds up?' })).json
    const agent = (await ana.api('GET', '/credentials')).json.credentials.find(
      (one: any) => one.kind === 'agent',
    )
    expect((await anaAgent.api('PUT', `/debates/${room.id}/agent`, { agentId: agent.id })).status).toBe(403)
  })
})
