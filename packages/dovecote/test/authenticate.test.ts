import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SAME_SITE_HEADER, sessionCookie } from '../src/http/authenticate.ts'
import { PUBLIC_URL, type Session, type TestServer, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
})

afterEach(() => server?.close())

describe('telling who is calling', () => {
  it('takes a bearer token or the session cookie, and nobody without either', async () => {
    expect((await server.request('GET', '/api/v1/me', { token: ana.token })).status).toBe(200)
    expect((await server.request('GET', '/api/v1/me', { cookie: ana.cookie })).status).toBe(200)
    expect((await server.request('GET', '/api/v1/me')).status).toBe(401)
    expect((await server.request('GET', '/api/v1/me', { token: 'hbh_notatoken' })).status).toBe(401)
  })

  it('refuses a state-changing request with the cookie unless it came from our own page', async () => {
    const body = { to: [ana.me.member.id], body: 'x' }
    const forged = await server.request('POST', '/api/v1/drafts', {
      body,
      headers: { cookie: ana.cookie, origin: 'https://evil.example' },
    })
    expect(forged.status).toBe(403)
    const withoutHeader = await server.request('POST', '/api/v1/drafts', {
      body,
      headers: { cookie: ana.cookie },
    })
    expect(withoutHeader.status).toBe(403)
    const own = await server.request('POST', '/api/v1/conversations', {
      body: { participantIds: [] },
      headers: { cookie: ana.cookie, [SAME_SITE_HEADER]: '1', origin: PUBLIC_URL },
    })
    expect(own.status).toBe(400)
  })

  it('sets a session cookie scripts cannot read, marked secure on https', () => {
    expect(sessionCookie('tok', 60, 'http://localhost:8080')).toBe(
      'hb_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=60',
    )
    expect(sessionCookie('tok', 60, 'https://homingbird.example.com')).toMatch(/; Secure$/)
  })
})
