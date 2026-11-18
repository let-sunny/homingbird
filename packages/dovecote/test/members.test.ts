import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, connectAgent, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
})

afterEach(() => server.close())

describe('language on the profile', () => {
  it('follows the browser until a person picks a language', async () => {
    expect((await ana.api('GET', '/me')).json).not.toHaveProperty('locale')
  })

  it('remembers the language a person picks and returns it with the signed-in member', async () => {
    const updated = await ana.api('PATCH', '/me', { locale: 'ko' })
    expect(updated.status).toBe(200)
    expect(updated.json).toMatchObject({ name: 'Ana' })
    expect((await ana.api('GET', '/me')).json.locale).toBe('ko')
  })

  it('keeps the language when only the name changes, and forgets it when cleared', async () => {
    await ana.api('PATCH', '/me', { locale: 'ko' })
    await ana.api('PATCH', '/me', { name: 'Ana Lima' })
    expect((await ana.api('GET', '/me')).json.locale).toBe('ko')
    await ana.api('PATCH', '/me', { locale: null })
    expect((await ana.api('GET', '/me')).json).not.toHaveProperty('locale')
  })

  it('refuses a language that is not on the list', async () => {
    expect((await ana.api('PATCH', '/me', { locale: 'fr' })).status).toBe(400)
    expect((await ana.api('PATCH', '/me', { locale: 'ko-KR' })).status).toBe(400)
  })

  it('shows the language to its own member only, not in the directory', async () => {
    await ana.api('PATCH', '/me', { locale: 'ko' })
    const ben = await server.signIn('ben@example.com', 'Ben')
    const entries = (await ben.api('GET', '/directory')).json.entries
    expect(JSON.stringify(entries)).not.toContain('"locale"')
  })

  it('refuses an agent credential that tries to change the language', async () => {
    const agent = await connectAgent(server, ana)
    expect((await agent.api('PATCH', '/me', { locale: 'ko' })).status).toBe(403)
    expect((await ana.api('GET', '/me')).json).not.toHaveProperty('locale')
  })
})
