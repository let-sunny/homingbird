import { afterEach, describe, expect, it } from 'vitest'
import { levelIn } from '../src/domain/notification-level.ts'
import { type TestServer, connectAgent, startTestServer, storedRows } from './harness.ts'

let server: TestServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

describe('a person’s notification level', () => {
  it('is all until the person chooses, and keeps what they choose', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    expect((await ana.api('GET', '/me')).json.notifications).toBe('all')
    const chosen = await ana.api('PUT', '/me/notifications', { notifications: 'direct' })
    expect(chosen.json).toEqual({ notifications: 'direct' })
    expect((await ana.api('GET', '/me')).json.notifications).toBe('direct')
    await ana.api('PUT', '/me/notifications', { notifications: 'none' })
    expect((await ana.api('GET', '/me')).json.notifications).toBe('none')
    await ana.api('PUT', '/me/notifications', { notifications: 'all' })
    expect((await storedRows(server, 'members')).map((row) => row.notifications)).toEqual([null])
  })

  it('refuses a level it does not know, and an agent credential', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    expect((await ana.api('PUT', '/me/notifications', { notifications: 'mentions' })).status).toBe(400)
    const agent = await connectAgent(server, ana, { name: 'Ana agent' })
    expect((await agent.api('PUT', '/me/notifications', { notifications: 'none' })).status).toBe(403)
    expect((await ana.api('GET', '/me')).json.notifications).toBe('all')
  })

  it('is left out of the account while the mute feature is off', async () => {
    server = await startTestServer({ HB_FEATURES: 'mute=off' })
    const ana = await server.signIn('ana@example.com', 'Ana')
    expect((await ana.api('GET', '/me')).json).not.toHaveProperty('notifications')
    expect((await ana.api('PUT', '/me/notifications', { notifications: 'none' })).status).toBe(404)
  })

  it('reads a stored level it does not know as all, so nobody misses notes silently', () => {
    expect(levelIn(null)).toBe('all')
    expect(levelIn('mentions')).toBe('all')
    expect(levelIn('direct')).toBe('direct')
    expect(levelIn('none')).toBe('none')
  })
})
