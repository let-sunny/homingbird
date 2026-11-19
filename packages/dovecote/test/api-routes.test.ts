import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { routeFor } from '../src/http/api-routes.ts'
import { type Agent, type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session
let anaAgent: Agent

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
  anaAgent = await connectAgent(server, ana, { name: 'Ana agent' })
})

afterEach(() => server.close())

describe('the API routes', () => {
  it('find a route by method and path, with its parameters', () => {
    expect(routeFor({ method: 'POST', path: '/api/v1/drafts/note_1/send' })).toEqual({
      name: 'drafts.send',
      params: { id: 'note_1' },
    })
    expect(routeFor({ method: 'DELETE', path: '/api/v1/drafts/note_1/send' })).toBeNull()
    expect(routeFor({ method: 'GET', path: '/api/v2/server' })).toBeNull()
  })

  it('answer 404 for a route that does not exist and 400 for a body that is not JSON', async () => {
    expect((await ana.api('GET', '/nowhere')).status).toBe(404)
    const broken = await server.request('POST', '/api/v1/drafts', { token: ana.token, form: { body: 'x' } })
    expect([broken.status, broken.json.error.message]).toEqual([400, 'The request body is not valid JSON.'])
  })

  it('refuse a character larger than its byte limit before reading it', async () => {
    const refused = await ana.api('PUT', '/me/character', { grid: 'x'.repeat(100_000) })
    expect(refused.status).toBe(400)
    expect(refused.json.error.message).toMatch(/larger than \d+ bytes/)
  })

  it('hold each credential to its own drafting limit', async () => {
    const other = (await server.signIn('ben@example.com', 'Ben')).me.member.id
    let answered = 200
    for (let index = 0; index < 121 && answered === 200; index++)
      answered = (await anaAgent.api('POST', '/drafts', { to: [other], body: `draft ${index}` })).status
    expect(answered).toBe(429)
    expect((await ana.api('POST', '/drafts', { to: [other], body: 'by hand' })).status).toBe(200)
  })
})
