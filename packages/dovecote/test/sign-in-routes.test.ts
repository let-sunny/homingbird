import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SAME_SITE_HEADER } from '../src/http/authenticate.ts'
import { type Session, type TestServer, startTestServer } from './harness.ts'

let server: TestServer
let ana: Session

beforeEach(async () => {
  server = await startTestServer()
  ana = await server.signIn('ana@example.com', 'Ana')
})

afterEach(() => server.close())

describe('the sign-in routes', () => {
  it('show the development form with the state escaped, only on a development server', async () => {
    const form = await server.request('GET', '/auth/dev?state=%22%3E%3Cscript%3E')
    expect(form.status).toBe(200)
    expect(form.raw.body).toContain('value="&#34;&#62;&#60;script&#62;"')
    expect(form.raw.body).not.toContain('<script>')
    const production = server.requestWithSettings({
      HB_DEV_LOGIN: '',
      HB_PUBLIC_URL: 'https://homingbird.example.com',
      HB_OIDC_CLIENT_ID: 'c',
      HB_OIDC_CLIENT_SECRET: 's',
      HB_ADMIN_EMAILS: 'ana@example.com',
    })
    expect((await production('GET', '/auth/dev')).status).toBe(404)
  })

  it('sign out only from our own page, ending the session and clearing the cookie', async () => {
    expect(
      (await server.request('POST', '/auth/logout', { headers: { cookie: ana.cookie } })).headers,
    ).not.toHaveProperty('set-cookie')
    expect((await ana.api('GET', '/me')).status).toBe(200)
    const signedOut = await server.request('POST', '/auth/logout', {
      headers: { cookie: ana.cookie, [SAME_SITE_HEADER]: '1' },
    })
    expect(signedOut.status).toBe(204)
    expect(signedOut.headers['set-cookie']).toContain('Max-Age=0')
    expect((await ana.api('GET', '/me')).status).toBe(401)
  })

  it('send a refused sign-in back to the signed-out page with the reason, and answer 404 elsewhere', async () => {
    const refused = await server.request('GET', '/auth/callback?code=x&state=unknown')
    expect(refused.headers.location).toMatch(/^\/#\/signed-out\?reason=/)
    expect((await server.request('GET', '/auth/elsewhere')).status).toBe(404)
  })

  it('slow down an address that tries to sign in too often', async () => {
    let status = 302
    for (let attempt = 0; attempt < 301 && status !== 429; attempt++)
      status = (await server.request('GET', '/auth/login')).status
    expect(status).toBe(429)
  })
})
