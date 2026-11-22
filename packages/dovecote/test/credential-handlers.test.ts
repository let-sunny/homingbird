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

describe('the credential handlers', () => {
  it('list a person’s credentials, marking the one in use, and never a token', async () => {
    const listed = (await ana.api('GET', '/credentials')).json.credentials
    expect(listed.map((credential: any) => credential.kind).sort()).toEqual(['agent', 'human'])
    expect(JSON.stringify(listed)).not.toContain(ana.token)
    expect(JSON.stringify(listed)).not.toContain(anaAgent.token)
  })

  it('rename and revoke by a valid credential id only, answering nothing for a revocation', async () => {
    const agent = (await ana.api('GET', '/credentials')).json.credentials.find(
      (one: any) => one.kind === 'agent',
    )
    expect((await ana.api('PATCH', '/credentials/not-an-id', { name: 'x' })).status).toBe(400)
    expect((await ana.api('PATCH', `/credentials/${agent.id}`, { name: 'Laptop desk' })).json.name).toBe(
      'Laptop desk',
    )
    expect((await ana.api('DELETE', `/credentials/${agent.id}`)).json).toEqual({})
    expect((await anaAgent.api('GET', '/me')).status).toBe(401)
  })

  it('describe and decide a device request by its code, answering nothing for the decision', async () => {
    const started = await server.request('POST', '/oauth/device_authorization', {
      form: { client_name: 'CLI' },
    })
    const code = started.json.user_code
    expect((await ana.api('GET', `/device/${code}`)).json).toMatchObject({ userCode: code, client: 'CLI' })
    expect((await ana.api('POST', `/device/${code}`, { approve: false })).json).toEqual({})
    expect((await ana.api('GET', `/device/${code}`)).status).toBe(404)
    expect((await ben.api('GET', '/credentials')).json.credentials).toHaveLength(1)
  })
})
