import { createHash } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import type { Fetch } from '../src/auth/identity-provider.ts'
import { SESSION_COOKIE } from '../src/http/authenticate.ts'
import { run } from '../src/sql/database.ts'
import { insertInto } from '../src/sql/query.ts'
import { type TestServer, connectAgent, everyStoredValue, startTestServer, storedRows } from './harness.ts'

const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const CLAUDE_CLIENT_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
const VERIFIER = 'v'.repeat(64)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')

let server: TestServer

afterEach(() => server.close())

const claudeDocument = (overrides: Record<string, unknown> = {}) => ({
  client_id: CLAUDE_CLIENT_ID,
  client_name: 'Claude',
  redirect_uris: [CLAUDE_CALLBACK],
  token_endpoint_auth_method: 'none',
  ...overrides,
})

const serving = (document: unknown): { fetch: Fetch; fetched: string[] } => {
  const fetched: string[] = []
  return {
    fetched,
    fetch: async (url) => {
      fetched.push(url)
      return new Response(JSON.stringify(document), { headers: { 'content-type': 'application/json' } })
    },
  }
}

const register = (redirectUris: ReadonlyArray<string>) =>
  server.request('POST', '/oauth/register', {
    body: { client_name: 'Connector', redirect_uris: redirectUris },
  })

const authorizePath = (clientId: string, redirectUri: string, overrides: Record<string, string> = {}) =>
  `/oauth/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'xyz',
    ...overrides,
  })}`

const connect = async (clientId: string, redirectUri: string) => {
  const ana = await server.signIn('ana@example.com', 'Ana')
  const started = await server.request('GET', authorizePath(clientId, redirectUri), { cookie: ana.cookie })
  expect([started.status, started.headers.location]).toEqual([302, expect.stringMatching(/^\/#\/consent\//)])
  const consentId = started.headers.location!.split('/#/consent/')[1]!
  const consent = (await ana.api('GET', `/consent/${consentId}`)).json
  const decided = (await ana.api('POST', `/consent/${consentId}`, { approve: true })).json
  const code = new URL(decided.redirectTo).searchParams.get('code')!
  const tokens = await server.request('POST', '/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code,
      code_verifier: VERIFIER,
      client_id: clientId,
      redirect_uri: redirectUri,
    },
  })
  return { ana, consent, redirectTo: decided.redirectTo as string, tokens }
}

const auditActions = async (): Promise<string[]> =>
  (await storedRows(server, 'audit_log')).map((row) => String(row.action))

const authorizeRequests = async () =>
  (await storedRows(server, 'auth_requests')).filter((row) => row.kind === 'authorize')

describe('redirect hosts', () => {
  it('accepts loopback redirects on any port and the Claude callbacks by default', async () => {
    server = await startTestServer()
    for (const uri of [
      CLAUDE_CALLBACK,
      'https://claude.com/api/mcp/auth_callback',
      'http://127.0.0.1:53682/callback',
      'http://localhost:3334/oauth/callback',
      'http://[::1]:8000/cb',
    ])
      expect([uri, (await register([uri])).status]).toEqual([uri, 201])
  })

  it('refuses other https hosts by default, storing and auditing nothing', async () => {
    server = await startTestServer()
    for (const uri of [
      'https://client.example/callback',
      'https://evil.claude.ai/callback',
      'https://claude.ai.evil.example/callback',
      'https://claude.ai@evil.example/callback',
      'http://claude.ai/api/mcp/auth_callback',
    ]) {
      const refused = await register([CLAUDE_CALLBACK, uri])
      expect([uri, refused.status, refused.json.error]).toEqual([uri, 400, 'invalid_redirect_uri'])
    }
    expect(await storedRows(server, 'oauth_clients')).toEqual([])
    expect(await auditActions()).toEqual([])
  })

  it('accepts exactly the hosts an operator lists instead of the defaults', async () => {
    server = await startTestServer({ HB_OAUTH_REDIRECT_HOSTS: 'Agent.example, claude.ai' })
    expect((await register(['https://agent.example/cb'])).status).toBe(201)
    expect((await register([CLAUDE_CALLBACK])).status).toBe(201)
    expect((await register(['https://claude.com/api/mcp/auth_callback'])).status).toBe(400)
  })

  it('accepts only loopback and app redirects when the operator lists none', async () => {
    server = await startTestServer({ HB_OAUTH_REDIRECT_HOSTS: 'none' })
    expect((await register(['http://127.0.0.1/cb', 'cursor://anysphere.cursor/oauth'])).status).toBe(201)
    expect((await register([CLAUDE_CALLBACK])).status).toBe(400)
  })

  it('audits a registration with the client name and redirect hosts', async () => {
    server = await startTestServer()
    const registered = (await register([CLAUDE_CALLBACK, 'http://127.0.0.1:9/cb'])).json
    const [entry] = await storedRows(server, 'audit_log')
    expect(entry).toMatchObject({
      action: 'oauth.client.registered',
      target: registered.client_id,
      actor_id: null,
    })
    expect(JSON.parse(String(entry!.detail))).toEqual({
      clientName: 'Connector',
      redirectHosts: ['claude.ai', '127.0.0.1:9'],
    })
  })

  it('refuses at authorization a client whose redirect host is no longer allowed', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    await T.runPromise(
      run(
        insertInto('oauth_clients', {
          id: 'client_old',
          name: 'Old connector',
          redirect_uris: JSON.stringify(['https://client.example/callback']),
          created_at: 0,
        }),
      ),
      server.env,
    )
    const refused = await server.request(
      'GET',
      authorizePath('client_old', 'https://client.example/callback'),
      {
        cookie: ana.cookie,
      },
    )
    expect([refused.status, refused.raw.body]).toEqual([
      400,
      'invalid_redirect_uri: redirect_uri is not allowed on this server',
    ])
    expect(await authorizeRequests()).toEqual([])
  })

  it('lets a native client pick its loopback port at authorization, and holds it to that port', async () => {
    server = await startTestServer()
    const { client_id: clientId } = (await register(['http://127.0.0.1/callback'])).json
    const requested = 'http://127.0.0.1:50123/callback'
    const { consent, redirectTo, tokens } = await connect(clientId, requested)
    expect(consent.redirectHost).toBe('127.0.0.1:50123')
    expect(redirectTo.startsWith(`${requested}?`)).toBe(true)
    expect(tokens.status).toBe(200)

    const ana = await server.signIn('ana@example.com', 'Ana')
    const elsewhere = await server.request('GET', authorizePath(clientId, 'http://127.0.0.1:50123/other'), {
      cookie: ana.cookie,
    })
    expect(elsewhere.status).toBe(400)
  })
})

describe('client ID metadata documents', () => {
  it('advertises support while any host is listed', async () => {
    server = await startTestServer()
    const metadata = (await server.request('GET', '/.well-known/oauth-authorization-server')).json
    expect(metadata.client_id_metadata_document_supported).toBe(true)
    await server.close()
    server = await startTestServer({ HB_OAUTH_CLIENT_METADATA_HOSTS: 'none' })
    const without = (await server.request('GET', '/.well-known/oauth-authorization-server')).json
    expect(without.client_id_metadata_document_supported).toBe(false)
  })

  it('treats a Claude client_id URL as a registered client, named by its document', async () => {
    const claude = serving(claudeDocument())
    server = await startTestServer({}, { fetch: claude.fetch })
    const { consent, redirectTo, tokens } = await connect(CLAUDE_CLIENT_ID, CLAUDE_CALLBACK)
    expect(consent).toMatchObject({ client: 'Claude', redirectHost: 'claude.ai' })
    expect(redirectTo.startsWith(`${CLAUDE_CALLBACK}?`)).toBe(true)
    expect(tokens.status).toBe(200)
    const me = (await server.request('GET', '/api/v1/me', { token: tokens.json.access_token })).json
    expect(me.credential).toMatchObject({ kind: 'agent', name: 'Claude' })
    expect(claude.fetched).toEqual([CLAUDE_CLIENT_ID])
    expect(await storedRows(server, 'oauth_clients')).toEqual([])
  })

  it('fetches a document once while it is cached, and audits each fetch', async () => {
    const claude = serving(claudeDocument())
    server = await startTestServer({}, { fetch: claude.fetch })
    const ana = await server.signIn('ana@example.com', 'Ana')
    for (let attempt = 0; attempt < 3; attempt++)
      expect(
        (
          await server.request('GET', authorizePath(CLAUDE_CLIENT_ID, CLAUDE_CALLBACK), {
            cookie: ana.cookie,
          })
        ).status,
      ).toBe(302)
    expect(claude.fetched).toHaveLength(1)
    const resolved = (await storedRows(server, 'audit_log')).filter(
      (row) => row.action === 'oauth.client.resolved',
    )
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ target: CLAUDE_CLIENT_ID, actor_id: null })
    expect(JSON.parse(String(resolved[0]!.detail))).toEqual({
      clientName: 'Claude',
      redirectHosts: ['claude.ai'],
    })
  })

  it('refuses a document that names another client, leaving nothing behind and logging the reason', async () => {
    const forged = serving(claudeDocument({ client_id: 'https://claude.ai/someone-else' }))
    server = await startTestServer({}, { fetch: forged.fetch })
    const ana = await server.signIn('ana@example.com', 'Ana')
    const refused = await server.request('GET', authorizePath(CLAUDE_CLIENT_ID, CLAUDE_CALLBACK), {
      cookie: ana.cookie,
    })
    expect([refused.status, refused.headers.location, refused.raw.body]).toEqual([
      400,
      undefined,
      'invalid_client: The client metadata document was refused: the document names a different client_id.',
    ])
    expect(await authorizeRequests()).toEqual([])
    expect(await auditActions()).not.toContain('oauth.client.resolved')
    expect(server.logged).toContain(
      'oauth: refused a client metadata document (the document names a different client_id)',
    )
  })

  it('never fetches a document from a host that is not listed', async () => {
    const elsewhere = serving(claudeDocument({ client_id: 'https://agent.example/metadata' }))
    server = await startTestServer({}, { fetch: elsewhere.fetch })
    const refused = await server.request(
      'GET',
      authorizePath('https://agent.example/metadata', CLAUDE_CALLBACK),
    )
    expect(refused.raw.body).toBe(
      'invalid_client: The client metadata document was refused: agent.example is not on HB_OAUTH_CLIENT_METADATA_HOSTS.',
    )
    expect(elsewhere.fetched).toEqual([])
  })

  it('fetches from a host the operator lists, still holding its redirects to the redirect hosts', async () => {
    const agentId = 'https://agent.example/metadata'
    const agent = serving({
      client_id: agentId,
      client_name: 'Agent',
      redirect_uris: ['https://agent.example/cb'],
    })
    server = await startTestServer(
      { HB_OAUTH_CLIENT_METADATA_HOSTS: 'agent.example', HB_OAUTH_REDIRECT_HOSTS: 'agent.example' },
      { fetch: agent.fetch },
    )
    expect((await connect(agentId, 'https://agent.example/cb')).consent).toMatchObject({ client: 'Agent' })
    await server.close()

    server = await startTestServer(
      { HB_OAUTH_CLIENT_METADATA_HOSTS: 'agent.example' },
      { fetch: agent.fetch },
    )
    expect((await server.request('GET', authorizePath(agentId, 'https://agent.example/cb'))).status).toBe(400)
  })

  it('refuses a redirect_uri the document does not list', async () => {
    server = await startTestServer({}, { fetch: serving(claudeDocument()).fetch })
    const refused = await server.request(
      'GET',
      authorizePath(CLAUDE_CLIENT_ID, 'https://claude.com/api/mcp/auth_callback'),
    )
    expect(refused.raw.body).toBe('invalid_redirect_uri: redirect_uri is not registered')
  })

  it('refuses an http client_id instead of looking it up as a registered client', async () => {
    server = await startTestServer()
    const refused = await server.request('GET', authorizePath('http://claude.ai/metadata', CLAUDE_CALLBACK))
    expect(refused.raw.body).toBe(
      'invalid_client: The client metadata document was refused: the client_id must be an https URL.',
    )
  })
})

describe('pre-registered clients', () => {
  const TOOL = 'team-tool|Team Tool|https://tool.example/cb;http://127.0.0.1/cb'

  it('connects a client named in HB_OAUTH_CLIENTS, on the redirect hosts the operator gave it', async () => {
    server = await startTestServer({ HB_OAUTH_CLIENTS: TOOL })
    const { consent, tokens } = await connect('team-tool', 'https://tool.example/cb')
    expect(consent).toMatchObject({ client: 'Team Tool', redirectHost: 'tool.example' })
    expect(tokens.status).toBe(200)
    expect((await connect('team-tool', 'http://127.0.0.1:4000/cb')).tokens.status).toBe(200)
    expect(await storedRows(server, 'oauth_clients')).toEqual([])
  })

  it('refuses a redirect the operator did not give the client', async () => {
    server = await startTestServer({ HB_OAUTH_CLIENTS: TOOL })
    const refused = await server.request('GET', authorizePath('team-tool', 'https://tool.example/other'))
    expect(refused.raw.body).toBe('invalid_redirect_uri: redirect_uri is not registered')
    expect(
      (await server.request('GET', authorizePath('other-tool', 'https://tool.example/cb'))).raw.body,
    ).toBe('invalid_client: Unknown client_id.')
  })
})

describe('signing in during authorization', () => {
  const signInThrough = async (location: string, email = 'ana@example.com') => {
    const started = await server.request('GET', location)
    const state = new URL(started.headers.location!).searchParams.get('state')!
    const submitted = await server.request('POST', '/auth/dev', { form: { email, name: 'Ana', state } })
    const finished = await server.request('GET', submitted.headers.location!)
    const token = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(finished.headers['set-cookie']!)![1]!
    return { returnedTo: finished.headers.location!, cookie: `${SESSION_COOKIE}=${token}` }
  }

  it('sends a browser without a session to sign in, opening nothing yet', async () => {
    server = await startTestServer()
    const path = authorizePath('client_x', CLAUDE_CALLBACK)
    const { client_id: clientId } = (await register([CLAUDE_CALLBACK])).json
    const wanted = authorizePath(clientId, CLAUDE_CALLBACK)
    const started = await server.request('GET', wanted)
    expect(started.status).toBe(302)
    const location = new URL(started.headers.location!, 'http://localhost:8080')
    expect(location.pathname).toBe('/auth/login')
    expect(location.searchParams.get('return_to')).toBe(wanted)
    expect(await authorizeRequests()).toEqual([])
    expect((await server.request('GET', path)).status).toBe(400)
  })

  it('comes back to the same authorization request after signing in, and shows its consent', async () => {
    server = await startTestServer()
    const { client_id: clientId } = (await register([CLAUDE_CALLBACK])).json
    const wanted = authorizePath(clientId, CLAUDE_CALLBACK)
    const { returnedTo, cookie } = await signInThrough(
      (await server.request('GET', wanted)).headers.location!,
    )
    expect(returnedTo).toBe(wanted)
    const resumed = await server.request('GET', returnedTo, { cookie })
    expect(resumed.headers.location).toMatch(/^\/#\/consent\//)
    const consentId = resumed.headers.location!.split('/#/consent/')[1]!
    const consent = await server.request('GET', `/api/v1/consent/${consentId}`, { cookie })
    expect(consent.json).toMatchObject({ client: 'Connector', redirectHost: 'claude.ai' })
    const decided = await server.request('POST', `/api/v1/consent/${consentId}`, {
      cookie,
      body: { approve: true },
    })
    expect(new URL(decided.json.redirectTo).searchParams.get('state')).toBe('xyz')
  })

  it('refuses an invalid request before asking anyone to sign in', async () => {
    server = await startTestServer()
    const { client_id: clientId } = (await register([CLAUDE_CALLBACK])).json
    const refused = await server.request(
      'GET',
      authorizePath(clientId, CLAUDE_CALLBACK, { code_challenge: 'x' }),
    )
    expect([refused.status, refused.headers.location]).toEqual([400, undefined])
  })

  it('treats an expired, revoked or agent credential as no session', async () => {
    server = await startTestServer()
    const ana = await server.signIn('ana@example.com', 'Ana')
    const agent = await connectAgent(server, ana)
    const { client_id: clientId } = (await register([CLAUDE_CALLBACK])).json
    const wanted = authorizePath(clientId, CLAUDE_CALLBACK)
    for (const options of [
      { cookie: `${SESSION_COOKIE}=made-up` },
      { cookie: `${SESSION_COOKIE}=${agent.token}` },
      { token: agent.token },
    ])
      expect((await server.request('GET', wanted, options)).headers.location).toMatch(/^\/auth\/login\?/)
    await server.clock.advance(31 * 24 * 60 * 60_000)
    expect((await server.request('GET', wanted, { cookie: ana.cookie })).headers.location).toMatch(
      /^\/auth\/login\?/,
    )
    expect(await authorizeRequests()).toEqual([])
  })

  it('comes back to the device page after signing in', async () => {
    server = await startTestServer()
    const { returnedTo } = await signInThrough(
      `/auth/login?${new URLSearchParams({ return_to: '/#/device/BCDF-GHJK' })}`,
    )
    expect(returnedTo).toBe('/#/device/BCDF-GHJK')
  })

  it('never returns to another site, whatever return path it is given', async () => {
    server = await startTestServer()
    for (const returnTo of ['//evil.example', '/\t/evil.example', 'https://evil.example', '/\\evil.example'])
      expect(
        (await signInThrough(`/auth/login?${new URLSearchParams({ return_to: returnTo })}`)).returnedTo,
      ).toBe('/')
  })
})

describe('secrets in the new paths', () => {
  it('writes no token, code or verifier into logs, audit entries or stored client data', async () => {
    const claude = serving(claudeDocument())
    server = await startTestServer(
      { HB_OAUTH_CLIENTS: 'team-tool|Team Tool|https://tool.example/cb' },
      claude,
    )
    const viaDocument = await connect(CLAUDE_CLIENT_ID, CLAUDE_CALLBACK)
    const viaConfig = await connect('team-tool', 'https://tool.example/cb')
    const code = new URL(viaDocument.redirectTo).searchParams.get('code')!
    const secrets = [viaDocument, viaConfig].flatMap(({ tokens }) => [
      tokens.json.access_token,
      tokens.json.refresh_token,
    ])
    const everything = `${server.logged.join('\n')}\n${await everyStoredValue(server)}`
    for (const secret of [...secrets, code, VERIFIER]) expect(everything.includes(secret)).toBe(false)
  })
})
