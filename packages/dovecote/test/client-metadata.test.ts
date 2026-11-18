import { Task as T, makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import {
  CACHE_LIFETIME_MS,
  type ClientMetadataEnv,
  FETCH_TIMEOUT_MS,
  MAX_CACHED_DOCUMENTS,
  MAX_DOCUMENT_BYTES,
  isClientMetadataUrl,
  isFetchableHostName,
  makeClientMetadataDocuments,
} from '../src/auth/client-metadata.ts'
import type { Fetch } from '../src/auth/identity-provider.ts'

const CLIENT_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

const documentOf = (overrides: Record<string, unknown> = {}) => ({
  client_id: CLIENT_ID,
  client_name: 'Claude',
  redirect_uris: [CALLBACK],
  token_endpoint_auth_method: 'none',
  ...overrides,
})

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })

interface Recorded {
  readonly fetch: Fetch
  readonly requests: Array<{ url: string; init: RequestInit | undefined }>
}

const recording = (answer: (url: string) => Response | Promise<Response>): Recorded => {
  const requests: Recorded['requests'] = []
  return {
    requests,
    fetch: async (url, init) => {
      requests.push({ url, init })
      return answer(url)
    },
  }
}

const environment = (oauth: Partial<ClientMetadataEnv['config']['oauth']> = {}) => {
  const clock = makeTestClock(1_000)
  const env: ClientMetadataEnv = {
    clock,
    config: {
      oauth: {
        clientMetadataHosts: ['claude.ai', 'claude.com'],
        redirectHosts: ['claude.ai'],
        clients: [],
        ...oauth,
      },
    },
  }
  return { clock, env }
}

const resolveWith = async (
  answer: (url: string) => Response | Promise<Response>,
  clientId = CLIENT_ID,
  oauth: Partial<ClientMetadataEnv['config']['oauth']> = {},
) => {
  const recorded = recording(answer)
  const { env } = environment(oauth)
  const result = await T.runPromise(
    T.result(makeClientMetadataDocuments(recorded.fetch).resolve(clientId)),
    env,
  )
  return { result, requests: recorded.requests }
}

const reasonOf = (result: { _tag: string; error?: unknown }): string =>
  result._tag === 'Err' ? (result.error as { reason: string }).reason : 'accepted'

describe('client ID metadata documents', () => {
  it('fetches the document named by the client_id and takes its name and redirect URIs', async () => {
    const { result, requests } = await resolveWith(() => jsonResponse(documentOf()))
    expect(result).toMatchObject({
      _tag: 'Ok',
      value: {
        fetched: true,
        client: { client_id: CLIENT_ID, client_name: 'Claude', redirect_uris: [CALLBACK] },
      },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe(CLIENT_ID)
    expect(requests[0]!.init).toMatchObject({ redirect: 'manual', headers: { accept: 'application/json' } })
    expect(requests[0]!.init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('accepts a JSON media type with parameters or a structured suffix', async () => {
    for (const type of ['application/json; charset=utf-8', 'application/oauth-client+json'])
      expect(
        reasonOf(
          (await resolveWith(() => jsonResponse(documentOf(), { headers: { 'content-type': type } }))).result,
        ),
      ).toBe('accepted')
  })

  it('names the client after its host when the document gives no name', async () => {
    const { result } = await resolveWith(() => jsonResponse(documentOf({ client_name: undefined })))
    expect(result).toMatchObject({ _tag: 'Ok', value: { client: { client_name: 'claude.ai' } } })
    const blank = await resolveWith(() => jsonResponse(documentOf({ client_name: '   ' })))
    expect(blank.result).toMatchObject({ _tag: 'Ok', value: { client: { client_name: 'claude.ai' } } })
  })

  it('shortens a very long client name', async () => {
    const { result } = await resolveWith(() => jsonResponse(documentOf({ client_name: 'n'.repeat(500) })))
    expect(result._tag === 'Ok' && result.value.client.client_name).toHaveLength(200)
  })

  it('caches a document for a bounded time, then fetches it again', async () => {
    const recorded = recording(() => jsonResponse(documentOf()))
    const { clock, env } = environment()
    const documents = makeClientMetadataDocuments(recorded.fetch)
    const resolve = () => T.runPromise(documents.resolve(CLIENT_ID), env)
    expect((await resolve()).fetched).toBe(true)
    await clock.advance(CACHE_LIFETIME_MS - 1)
    expect((await resolve()).fetched).toBe(false)
    expect(recorded.requests).toHaveLength(1)
    await clock.advance(1)
    expect((await resolve()).fetched).toBe(true)
    expect(recorded.requests).toHaveLength(2)
  })

  it('keeps a bounded number of documents, forgetting the oldest first', async () => {
    const recorded = recording((url) => jsonResponse(documentOf({ client_id: url })))
    const { env } = environment()
    const documents = makeClientMetadataDocuments(recorded.fetch)
    const idOf = (index: number) => `${CLIENT_ID}/${index}`
    for (let index = 0; index <= MAX_CACHED_DOCUMENTS; index++)
      await T.runPromise(documents.resolve(idOf(index)), env)
    expect((await T.runPromise(documents.resolve(idOf(MAX_CACHED_DOCUMENTS)), env)).fetched).toBe(false)
    expect((await T.runPromise(documents.resolve(idOf(1)), env)).fetched).toBe(false)
    expect((await T.runPromise(documents.resolve(idOf(0)), env)).fetched).toBe(true)
  })

  it('does not cache a refused document', async () => {
    let answer = jsonResponse(documentOf({ client_id: 'https://claude.ai/other' }))
    const recorded = recording(() => answer)
    const { env } = environment()
    const documents = makeClientMetadataDocuments(recorded.fetch)
    expect((await T.runPromise(T.result(documents.resolve(CLIENT_ID)), env))._tag).toBe('Err')
    answer = jsonResponse(documentOf())
    expect((await T.runPromise(documents.resolve(CLIENT_ID), env)).fetched).toBe(true)
  })

  it('follows a redirect that stays on an allowed host', async () => {
    const moved = 'https://claude.com/oauth/mcp-oauth-client-metadata'
    const { result, requests } = await resolveWith((url) =>
      url === CLIENT_ID
        ? new Response(null, { status: 301, headers: { location: moved } })
        : jsonResponse(documentOf()),
    )
    expect(reasonOf(result)).toBe('accepted')
    expect(requests.map((request) => request.url)).toEqual([CLIENT_ID, moved])
  })

  it.each([
    ['another host', 'https://attacker.example/metadata'],
    ['plain http', 'http://claude.ai/oauth/mcp-oauth-client-metadata'],
    ['a loopback address', 'https://127.0.0.1/metadata'],
    ['a private address', 'https://10.0.0.7/metadata'],
    ['an IPv6 address', 'https://[::1]/metadata'],
    ['an unparseable location', 'https://'],
  ])('refuses a redirect to %s', async (_, location) => {
    const { result, requests } = await resolveWith(
      () => new Response(null, { status: 302, headers: { location } }),
    )
    expect(reasonOf(result)).toBe('the document redirects to a place that is not allowed')
    expect(requests).toHaveLength(1)
  })

  it('refuses a redirect without a location', async () => {
    const { result } = await resolveWith(() => new Response(null, { status: 307 }))
    expect(reasonOf(result)).toBe('the document redirects to a place that is not allowed')
  })

  it('refuses to follow redirects forever', async () => {
    const { result, requests } = await resolveWith(
      () => new Response(null, { status: 302, headers: { location: CLIENT_ID } }),
    )
    expect(reasonOf(result)).toBe('the document redirects too many times')
    expect(requests).toHaveLength(4)
  })

  it.each([
    ['http://claude.ai/oauth/metadata', 'the client_id must be an https URL'],
    ['https://attacker.example/metadata', 'attacker.example is not on HB_OAUTH_CLIENT_METADATA_HOSTS'],
    ['https://evil.claude.ai/metadata', 'evil.claude.ai is not on HB_OAUTH_CLIENT_METADATA_HOSTS'],
    ['https://127.0.0.1/metadata', 'the client_id must name a public host, not an address'],
    ['https://192.168.1.1/metadata', 'the client_id must name a public host, not an address'],
    ['https://[fd00::1]/metadata', 'the client_id must name a public host, not an address'],
    ['https://localhost/metadata', 'the client_id must name a public host, not an address'],
    ['https://claude.ai:8443/metadata', 'the client_id must use the default https port'],
    ['https://claude.ai/', 'the client_id must have a path'],
    [
      'https://claude.ai',
      'the client_id must be a plain https URL without credentials, fragment or dot segments',
    ],
    [
      'https://claude.ai/a/../metadata',
      'the client_id must be a plain https URL without credentials, fragment or dot segments',
    ],
    [
      'https://claude.ai/metadata#x',
      'the client_id must be a plain https URL without credentials, fragment or dot segments',
    ],
    [
      'https://u:p@claude.ai/metadata',
      'the client_id must be a plain https URL without credentials, fragment or dot segments',
    ],
    [
      'https://CLAUDE.ai/metadata',
      'the client_id must be a plain https URL without credentials, fragment or dot segments',
    ],
    ['https://', 'the client_id is not a URL'],
  ])('refuses the client_id %s without fetching anything', async (clientId, reason) => {
    const { result, requests } = await resolveWith(
      () => jsonResponse(documentOf({ client_id: clientId })),
      clientId,
    )
    expect(reasonOf(result)).toBe(reason)
    expect(requests).toEqual([])
  })

  it('refuses every document when no host is listed', async () => {
    const { result, requests } = await resolveWith(() => jsonResponse(documentOf()), CLIENT_ID, {
      clientMetadataHosts: [],
    })
    expect(reasonOf(result)).toBe('claude.ai is not on HB_OAUTH_CLIENT_METADATA_HOSTS')
    expect(requests).toEqual([])
  })

  it.each([
    ['an error status', () => jsonResponse(documentOf(), { status: 404 }), 'the document host answered 404'],
    [
      'a page that is not JSON',
      () => new Response(JSON.stringify(documentOf()), { headers: { 'content-type': 'text/html' } }),
      'the document is not served as JSON',
    ],
    [
      'no content type',
      () => new Response(new Blob([JSON.stringify(documentOf())]).stream()),
      'the document is not served as JSON',
    ],
    [
      'a declared length over the limit',
      () => jsonResponse(documentOf(), { headers: { 'content-length': String(MAX_DOCUMENT_BYTES + 1) } }),
      'the document is too large',
    ],
    [
      'a body over the limit',
      () => jsonResponse(documentOf({ client_name: 'x'.repeat(MAX_DOCUMENT_BYTES) })),
      'the document is too large',
    ],
    ['malformed JSON', () => jsonResponse('{"client_id":'), 'the document is not valid JSON'],
    ['an array', () => jsonResponse([documentOf()]), 'the document is not a JSON object'],
    ['null', () => jsonResponse('null'), 'the document is not a JSON object'],
    [
      'another client_id',
      () => jsonResponse(documentOf({ client_id: 'https://claude.ai/other' })),
      'the document names a different client_id',
    ],
    [
      'a client secret',
      () => jsonResponse(documentOf({ client_secret: 'shh' })),
      'the document asks for client authentication',
    ],
    [
      'client authentication',
      () => jsonResponse(documentOf({ token_endpoint_auth_method: 'client_secret_basic' })),
      'the document asks for client authentication',
    ],
    [
      'no redirect URIs',
      () => jsonResponse(documentOf({ redirect_uris: [] })),
      'the document lists no redirect URI, or one that is not allowed',
    ],
    [
      'redirect URIs that are not strings',
      () => jsonResponse(documentOf({ redirect_uris: [7] })),
      'the document lists no redirect URI, or one that is not allowed',
    ],
    [
      'redirect URIs that are not a list',
      () => jsonResponse(documentOf({ redirect_uris: CALLBACK })),
      'the document lists no redirect URI, or one that is not allowed',
    ],
    [
      'a redirect URI on an unlisted host',
      () => jsonResponse(documentOf({ redirect_uris: [CALLBACK, 'https://attacker.example/cb'] })),
      'the document lists no redirect URI, or one that is not allowed',
    ],
    [
      'too many redirect URIs',
      () =>
        jsonResponse(documentOf({ redirect_uris: Array.from({ length: 11 }, (_, i) => `${CALLBACK}/${i}`) })),
      'the document lists no redirect URI, or one that is not allowed',
    ],
  ])('refuses %s', async (_, answer, reason) => {
    expect(reasonOf((await resolveWith(answer)).result)).toBe(reason)
  })

  it('refuses when the host cannot be reached, without repeating the cause', async () => {
    const { result } = await resolveWith(() => {
      throw new Error('getaddrinfo ENOTFOUND with internal detail')
    })
    expect(reasonOf(result)).toBe('the document could not be fetched')
  })

  it('gives up on a host that does not answer in time, and aborts the request', async () => {
    let aborted = false
    const fetch: Fetch = (_, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new Error('aborted'))
        })
      })
    const { clock, env } = environment()
    const pending = T.runPromise(T.result(makeClientMetadataDocuments(fetch).resolve(CLIENT_ID)), env)
    await clock.advance(FETCH_TIMEOUT_MS)
    expect(reasonOf(await pending)).toBe('the document host did not answer in time')
    expect(aborted).toBe(true)
  })

  it('recognizes a client_id that names a document', () => {
    expect(
      ['https://claude.ai/x', 'HTTP://claude.ai/x', 'client_abc', 'tool'].map(isClientMetadataUrl),
    ).toEqual([true, true, false, false])
  })

  it.each([
    ['claude.ai', true],
    ['metadata.agent.example', true],
    ['localhost', false],
    ['app.localhost', false],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['[::1]', false],
    ['under_score.example', false],
    ['', false],
  ])('judges %s as a host documents may be fetched from: %s', (host, fetchable) => {
    expect(isFetchableHostName(host)).toBe(fetchable)
  })
})
