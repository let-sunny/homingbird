import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type Agent,
  type Session,
  type TestServer,
  connectAgent,
  startTestServer,
  storedRows,
} from './harness.ts'

let server: TestServer
let ana: Session
let ben: Session
let agent: Agent

beforeEach(async () => {
  server = await startTestServer({ HB_FEATURES: 'draftPreviews=on', HB_CHANNELS: 'lobby' })
  ana = await server.signIn('ana@example.com', 'Ana')
  ben = await server.signIn('ben@example.com', 'Ben')
  agent = await connectAgent(server, ana, { name: 'Ana agent' })
})

afterEach(() => server?.close())

describe('the draft preview routes', () => {
  it('reads and saves whom a person lets see their agent’s drafts, and audits only how many', async () => {
    expect((await ana.api('GET', '/me/draft-previews')).json).toEqual({ people: [], channels: [] })
    await ana.api('PUT', '/channels/lobby/membership', {})
    const saved = await ana.api('PUT', '/me/draft-previews', {
      people: [ben.me.member.id],
      channels: ['lobby'],
    })
    expect(saved.json).toEqual({ people: [ben.me.member.id], channels: ['lobby'] })
    expect((await ana.api('GET', '/me/draft-previews')).json).toEqual(saved.json)
    const audited = (await storedRows(server, 'audit_events')).filter(
      (row) => row.event === 'draft_preview.allowed_changed',
    )
    expect(audited.map((row) => [row.target_id, JSON.parse(String(row.detail))])).toEqual([
      [ana.me.member.id, { people: 1, channels: 1 }],
    ])
  })

  it('refuses an agent credential on every preview route', async () => {
    expect((await agent.api('GET', '/me/draft-previews')).status).toBe(403)
    expect((await agent.api('PUT', '/me/draft-previews', { people: [], channels: [] })).status).toBe(403)
    expect((await agent.api('GET', '/conversations/conv_abcdefghijkl/previews')).status).toBe(403)
  })

  it('answers 404 for a conversation the person is not in, and 400 for a malformed id', async () => {
    expect((await ben.api('GET', '/conversations/conv_abcdefghijkl/previews')).status).toBe(404)
    expect((await ben.api('GET', '/conversations/nonsense/previews')).status).toBe(400)
  })

  it('answers 404 on every preview route while the feature is off', async () => {
    const off = await startTestServer()
    const carl = await off.signIn('carl@example.com', 'Carl')
    expect((await carl.api('GET', '/me/draft-previews')).status).toBe(404)
    expect((await carl.api('PUT', '/me/draft-previews', { people: [], channels: [] })).status).toBe(404)
    await off.close()
  })
})
