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

const directoryChanges = (memberId: string) => {
  const open = new AbortController()
  const changes: string[] = []
  const subscription = server.env.hub.subscribe(memberId as never, 'hidden', open.signal)
  void (async () => {
    for await (const event of subscription)
      if (event.body.type === 'directory.changed') changes.push(event.body.memberId)
  })()
  return { changes, stop: () => open.abort() }
}

describe('the account handlers', () => {
  it('describe the server to anyone, with its version, features and protocol', async () => {
    const info = (await server.request('GET', '/api/v1/info')).json
    expect(info).toMatchObject({ name: 'dovecote', signInWith: 'development login', contactMode: 'open' })
    expect(typeof info.protocolVersion).toBe('number')
    expect(info.features).toMatchObject({ channels: true, analytics: false })
  })

  it('say who is signed in, with the language only once the person chose one', async () => {
    const me = (await ana.api('GET', '/me')).json
    expect(me.member.id).toBe(ana.me.member.id)
    expect(me.credential.kind).toBe('human')
    expect(me).not.toHaveProperty('locale')
    expect((await anaAgent.api('GET', '/me')).json.credential.kind).toBe('agent')
  })

  it('tell everyone’s directory when a person changes their profile', async () => {
    const watching = directoryChanges(ben.me.member.id)
    expect((await ana.api('PATCH', '/me', { profile: 'Billing and refunds' })).json.profile).toBe(
      'Billing and refunds',
    )
    await server.clock.flush()
    expect(watching.changes).toContain(ana.me.member.id)
    watching.stop()
  })

  it('list the directory a member may see', async () => {
    const entries = (await anaAgent.api('GET', '/directory')).json.entries
    expect(entries.map((entry: any) => entry.member.name).sort()).toEqual(['Ana', 'Ben'])
  })
})
