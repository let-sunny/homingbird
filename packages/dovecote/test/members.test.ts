import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Session, type TestServer, connectAgent, startTestServer, storedRows } from './harness.ts'

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

describe('the directory', () => {
  it('narrows to the active members of one team, never of a channel’s group', async () => {
    const ben = await server.signIn('ben@example.com', 'Ben')
    const cy = await server.signIn('cy@example.com', 'Cy')
    const group = (
      await ana.api('POST', '/admin/groups', {
        name: 'Finance',
        memberIds: [ben.me.member.id, cy.me.member.id],
      })
    ).json.id
    const namesIn = async (id: string) =>
      (await ben.api('GET', `/directory?group=${id}`)).json.entries.map((entry: any) => entry.member.name)
    expect(await namesIn(group)).toEqual(['Ben', 'Cy'])
    await ana.api('PATCH', `/admin/members/${cy.me.member.id}`, { status: 'deactivated' })
    expect(await namesIn(group)).toEqual(['Ben'])
    expect(await namesIn('grp_missing000000')).toEqual([])
    const own = (
      await ben.api('POST', '/channels', { slug: 'payroll', description: 'Salaries', visibility: 'private' })
    ).json.managedBy
    expect(await namesIn(own)).toEqual([])
    expect((await ben.api('GET', '/directory')).json.entries).toHaveLength(2)
  })
})

describe('deactivation', () => {
  const REDIRECT = 'https://client.example/callback'
  const VERIFIER = 'v'.repeat(64)
  const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
  const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

  let oauthServer: TestServer
  let admin: Session
  let leaver: Session

  beforeEach(async () => {
    oauthServer = await startTestServer({ HB_OAUTH_REDIRECT_HOSTS: 'client.example' })
    admin = await oauthServer.signIn('ana@example.com', 'Ana')
    leaver = await oauthServer.signIn('ben@example.com', 'Ben')
  })

  afterEach(() => oauthServer.close())

  const token = (form: Record<string, string>) => oauthServer.request('POST', '/oauth/token', { form })

  const approvedCode = async () => {
    const { client_id: clientId } = (
      await oauthServer.request('POST', '/oauth/register', {
        body: { client_name: 'Connector', redirect_uris: [REDIRECT] },
      })
    ).json
    const started = await oauthServer.request(
      'GET',
      `/oauth/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
        state: 'xyz',
      })}`,
      { cookie: leaver.cookie },
    )
    const consentId = started.headers.location!.split('/#/consent/')[1]!
    const decided = await leaver.api('POST', `/consent/${consentId}`, { approve: true })
    const code = new URL(decided.json.redirectTo).searchParams.get('code')!
    return () =>
      token({
        grant_type: 'authorization_code',
        code,
        code_verifier: VERIFIER,
        client_id: clientId,
        redirect_uri: REDIRECT,
      })
  }

  const approvedDeviceCode = async () => {
    const started = await oauthServer.request('POST', '/oauth/device_authorization', {
      form: { client_name: 'Terminal', scope: 'notes' },
    })
    await leaver.api('POST', `/device/${started.json.user_code}`, { approve: true })
    return () => token({ grant_type: DEVICE_GRANT, device_code: started.json.device_code })
  }

  it('stops every kind of credential at once, refreshing included, and any sign-in not yet finished', async () => {
    const agent = await connectAgent(oauthServer, leaver)
    const connector = (await (await approvedCode())()).json
    const unfinishedConnector = await approvedCode()
    const unfinishedDevice = await approvedDeviceCode()
    const asConnector = () => oauthServer.request('GET', '/api/v1/me', { token: connector.access_token })
    expect((await asConnector()).status).toBe(200)

    await admin.api('PATCH', `/admin/members/${leaver.me.member.id}`, { status: 'deactivated' })

    expect((await leaver.api('GET', '/me')).status).toBe(401)
    expect((await agent.api('GET', '/me')).status).toBe(401)
    expect((await asConnector()).status).toBe(401)
    expect(
      (await token({ grant_type: 'refresh_token', refresh_token: connector.refresh_token })).json.error,
    ).toBe('invalid_grant')
    expect((await unfinishedConnector()).json.error).toBe('invalid_grant')
    expect((await unfinishedDevice()).json.error).toBe('access_denied')
    const held = (await storedRows(oauthServer, 'credentials')).filter(
      (row) => row.member_id === leaver.me.member.id,
    )
    expect(held).toHaveLength(3)
    expect(held.filter((row) => row.revoked_at === null)).toEqual([])
  })
})
