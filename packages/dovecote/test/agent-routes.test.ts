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

const rpc = (path: string, body: unknown, token = anaAgent.token) => server.request('POST', path, { token, body })

describe('the MCP endpoint', () => {
  it('answers JSON-RPC for a bearer credential and acts as that member', async () => {
    const initialized = await rpc('/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    })
    expect(initialized.status).toBe(200)
    expect(initialized.json.result.serverInfo.name).toBe('homingbird')
    expect(initialized.headers['access-control-allow-origin']).toBe('*')
    const tools = (await rpc('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json.result.tools
    expect(tools.length).toBeGreaterThan(0)
    expect((await rpc('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(204)
  })

  it('cannot be used to send: a draft made through it still waits for the person', async () => {
    const tools = (await rpc('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json.result.tools
    const names: string[] = tools.map((tool: { name: string }) => tool.name)
    expect(names.filter((name) => /approve|send|discard|contact|block|credential/i.test(name))).toEqual([])
    const drafted = await rpc('/mcp', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'draft_note', arguments: { to: 'ben@example.com', body: 'via MCP' } },
    })
    expect(drafted.json.error).toBeUndefined()
    const drafts = (await ana.api('GET', '/drafts')).json.drafts
    expect(drafts.map((draft: any) => [draft.body, draft.status, draft.origin])).toEqual([['via MCP', 'draft', 'agent']])
    expect((await ben.api('GET', '/inbox')).json.items).toEqual([])
  })

  it('refuses a missing credential, a body that is not JSON, and other methods', async () => {
    expect((await server.request('POST', '/mcp', { body: {} })).status).toBe(401)
    const broken = await server.request('POST', '/mcp', { token: anaAgent.token, headers: { 'content-type': 'application/json' }, form: {} })
    expect(broken.status).toBe(200)
    const invalid = await server.request('POST', '/mcp', {
      headers: { authorization: `Bearer ${anaAgent.token}`, 'content-type': 'application/json' },
    })
    expect([200, 204, 400]).toContain(invalid.status)
    expect((await server.request('GET', '/mcp', { token: anaAgent.token })).status).toBe(405)
  })
})

describe('the A2A endpoint', () => {
  it('publishes an agent card and accepts a message as a draft waiting for approval', async () => {
    const card = (await server.request('GET', '/.well-known/agent-card.json')).json
    expect(JSON.stringify(card)).toContain('http://localhost:8080/a2a')
    const sent = await rpc('/a2a', {
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          kind: 'message',
          messageId: 'm1',
          role: 'user',
          parts: [{ kind: 'text', text: 'via A2A' }],
          metadata: { to: 'ben@example.com' },
        },
      },
    })
    expect(sent.status).toBe(200)
    const drafts = (await ana.api('GET', '/drafts')).json.drafts
    expect(drafts.map((draft: any) => [draft.body, draft.status])).toEqual([['via A2A', 'draft']])
    expect((await ben.api('GET', '/inbox')).json.items).toEqual([])
  })
})
