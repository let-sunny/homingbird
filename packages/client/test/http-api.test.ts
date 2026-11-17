import { type Schema as S, Task as T } from '@homingbird/kernel'
import { arbitrary } from '@homingbird/kernel/testing'
import { type Route, type RouteName, contract, fillPath } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type Fetch, SAME_SITE_HEADER, authorizationHeaders, httpApi } from '../src/http-api.ts'

interface Call {
  readonly url: string
  readonly init: RequestInit
}

const noteBody = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0)
const sample = <A>(schema: S.Schema<A>): A => fc.sample(arbitrary(schema, { 'note-body': noteBody }), 1)[0]!

const answering = (status: number, body: unknown): { fetch: Fetch; calls: Call[] } => {
  const calls: Call[] = []
  return {
    calls,
    fetch: async (url, init = {}) => {
      calls.push({ url, init })
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
    },
  }
}

const parametersOf = (path: string): Record<string, string> =>
  Object.fromEntries([...path.matchAll(/:([A-Za-z]+)/g)].map((match) => [match[1]!, 'value/1']))

const invoke = (api: ReturnType<typeof httpApi>, name: RouteName, request: unknown) =>
  T.run((api[name] as (request: unknown) => T.Task<unknown, unknown>)(request))

const routes = (Object.keys(contract) as RouteName[]).map((name) => [name, contract[name] as Route] as const)

describe('httpApi', () => {
  it.each(routes)('%s sends the declared method, path and body, and decodes the response', async (name, route) => {
    const response = sample(route.response)
    const { fetch, calls } = answering(200, response)
    const api = httpApi({ serverUrl: 'https://hb.example.com/', fetch, token: () => 'hba_token' })
    const params = parametersOf(route.path)
    const body = route.body === undefined ? undefined : sample(route.body)
    const exit = await invoke(api, name, { params, ...(body !== undefined && { body }) })

    expect(exit).toMatchObject({ _tag: 'Ok' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`https://hb.example.com/api/v1${fillPath(route.path, params)}`)
    expect(calls[0]!.init.method).toBe(route.method)
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer hba_token')
    expect(calls[0]!.init.body).toBe(body === undefined ? undefined : JSON.stringify(body))
    expect((calls[0]!.init.headers as Record<string, string>)['content-type']).toBe(
      body === undefined ? undefined : 'application/json',
    )
  })

  it('works when called without a request for a route that needs none', async () => {
    const { fetch, calls } = answering(200, sample(contract['conversations.list'].response))
    const api = httpApi({ serverUrl: 'https://hb.example.com', fetch })
    expect(await T.run((api['conversations.list'] as () => T.Task<unknown, unknown>)())).toMatchObject({ _tag: 'Ok' })
    expect(calls[0]!.init.headers).toEqual({})
  })

  it('sends an empty object when a body route is called without a body', async () => {
    const { fetch, calls } = answering(200, sample(contract['drafts.send'].response))
    const api = httpApi({ serverUrl: 'https://hb.example.com', fetch })
    await invoke(api, 'drafts.send', { params: { id: 'note_abcdefghijkl' } })
    expect(calls[0]!.init.body).toBe('{}')
  })

  it('encodes the query and leaves out undefined values', async () => {
    const { fetch, calls } = answering(200, { notes: [] })
    const api = httpApi({ serverUrl: 'https://hb.example.com', fetch })
    await T.run(api['search.notes']({ query: { q: 'a b&c', limit: undefined } as never }))
    expect(calls[0]!.url).toBe('https://hb.example.com/api/v1/search?q=a+b%26c')
  })

  it('sends cookies and the same-site header for the web client, and no bearer token', async () => {
    const { fetch, calls } = answering(200, { conversations: [] })
    const api = httpApi({ serverUrl: '', fetch, sendsCookies: true, token: () => null })
    await T.run(api['conversations.list']({}))
    expect(calls[0]!.url).toBe('/api/v1/conversations')
    expect(calls[0]!.init.credentials).toBe('same-origin')
    expect(calls[0]!.init.headers).toEqual({ [SAME_SITE_HEADER]: '1' })
  })

  it('turns an error body into the matching tagged error', async () => {
    const { fetch } = answering(403, { error: { code: 'Forbidden', message: 'Only a person can do this.' } })
    const exit = await T.run(httpApi({ serverUrl: 'https://x.test', fetch })['conversations.list']({}))
    expect(exit).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Fail', error: { _tag: 'Forbidden', message: 'Only a person can do this.' } },
    })
  })

  it('falls back to the status when the error body is not ours', async () => {
    const { fetch } = answering(404, { message: 'nginx' })
    const exit = await T.run(httpApi({ serverUrl: 'https://x.test', fetch })['conversations.list']({}))
    expect(exit).toMatchObject({ _tag: 'Err', error: { error: { _tag: 'NotFound', message: 'The server answered 404.' } } })
  })

  it('reports a body that is not JSON', async () => {
    const { fetch } = answering(502, '<html>bad gateway</html>')
    const exit = await T.run(httpApi({ serverUrl: 'https://x.test', fetch })['conversations.list']({}))
    expect(exit).toMatchObject({ _tag: 'Err', error: { error: { _tag: 'Unavailable' } } })
  })

  it('reports an unreachable server', async () => {
    const fetch: Fetch = async () => {
      throw new TypeError('fetch failed')
    }
    const exit = await T.run(httpApi({ serverUrl: 'https://x.test', fetch })['conversations.list']({}))
    expect(exit).toMatchObject({
      _tag: 'Err',
      error: { error: { _tag: 'Unavailable', message: 'The Homingbird server could not be reached.' } },
    })
  })

  it('refuses a successful response that does not match the contract', async () => {
    const { fetch } = answering(200, { conversations: 'not a list' })
    const exit = await T.run(httpApi({ serverUrl: 'https://x.test', fetch })['conversations.list']({}))
    expect(exit).toMatchObject({ _tag: 'Err', error: { error: { _tag: 'Unavailable' } } })
    expect(JSON.stringify(exit)).toContain('conversations')
  })

  it('passes the abort signal so an interrupted call stops the request', async () => {
    let seen: AbortSignal | undefined
    const fetch: Fetch = (_, init) =>
      new Promise((_, reject) => {
        seen = init?.signal ?? undefined
        seen?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const stop = new AbortController()
    const running = T.run(httpApi({ serverUrl: 'https://x.test', fetch })['conversations.list']({}), undefined, stop.signal)
    await new Promise((resolve) => setImmediate(resolve))
    stop.abort()
    expect(await running).toMatchObject({ _tag: 'Err', error: { _tag: 'Interrupt' } })
    expect(seen?.aborted).toBe(true)
  })

  it('uses the global fetch when none is given', async () => {
    const original = globalThis.fetch
    const { fetch, calls } = answering(200, { conversations: [] })
    globalThis.fetch = fetch as typeof globalThis.fetch
    try {
      await T.run(httpApi({ serverUrl: 'https://x.test' })['conversations.list']({}))
      expect(calls).toHaveLength(1)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('authorizationHeaders', () => {
  it.each<[Parameters<typeof authorizationHeaders>[0], Record<string, string>]>([
    [{}, {}],
    [{ token: () => null }, {}],
    [{ token: () => 't' }, { authorization: 'Bearer t' }],
    [{ sendsCookies: true }, { [SAME_SITE_HEADER]: '1' }],
    [{ token: () => 't', sendsCookies: true }, { authorization: 'Bearer t', [SAME_SITE_HEADER]: '1' }],
  ])('builds headers for %j', (options, expected) => {
    expect(authorizationHeaders(options)).toEqual(expected)
  })
})
