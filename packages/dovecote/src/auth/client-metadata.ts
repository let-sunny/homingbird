import { type HasClock, Result, Task as T, pipe, tagged } from '@homingbird/kernel'
import type { Config } from '../config.ts'
import type { Fetch } from './identity-provider.ts'
import type { RegisteredClient } from './oauth.ts'
import { isAllowedRedirectUri, isLoopbackHost } from './redirect-policy.ts'

export interface ClientMetadataDocuments {
  readonly resolve: (clientId: string) => T.Task<ResolvedClient, ClientMetadataRefused, ClientMetadataEnv>
}

export interface ResolvedClient {
  readonly client: RegisteredClient
  readonly fetched: boolean
}

export interface ClientMetadataEnv extends HasClock {
  readonly config: Pick<Config, 'oauth'>
}

export const ClientMetadataRefused = tagged('ClientMetadataRefused')<{ readonly reason: string }>()
export type ClientMetadataRefused = ReturnType<typeof ClientMetadataRefused>

export const makeClientMetadataDocuments = (fetch: Fetch): ClientMetadataDocuments => {
  const cache = new Map<string, { readonly client: RegisteredClient; readonly expiresAt: number }>()
  return {
    resolve: (clientId) =>
      T.gen(function* () {
        const env = yield* T.ask<ClientMetadataEnv>()
        const { clientMetadataHosts, redirectHosts } = env.config.oauth
        const problem = fetchTargetProblem(clientId, clientMetadataHosts)
        if (problem !== null) return yield* T.fail(ClientMetadataRefused({ reason: problem }))
        const cached = cache.get(clientId)
        if (cached !== undefined && cached.expiresAt > env.clock.now())
          return { client: cached.client, fetched: false }
        const text = yield* documentText(fetch, clientId, clientMetadataHosts)
        const client = yield* T.fromResult(clientFrom(text, clientId, redirectHosts))
        cache.delete(clientId)
        if (cache.size >= MAX_CACHED_DOCUMENTS) cache.delete(cache.keys().next().value!)
        cache.set(clientId, { client, expiresAt: env.clock.now() + CACHE_LIFETIME_MS })
        return { client, fetched: true }
      }),
  }
}

export const isClientMetadataUrl = (clientId: string): boolean => /^https?:\/\//i.test(clientId)

export const isFetchableHostName = (hostname: string): boolean =>
  HOST_NAME.test(hostname) &&
  !/^[0-9.]+$/.test(hostname) &&
  !isLoopbackHost(hostname) &&
  !hostname.endsWith('.localhost')

export const CACHE_LIFETIME_MS = 10 * 60_000
export const FETCH_TIMEOUT_MS = 5_000
export const MAX_DOCUMENT_BYTES = 5 * 1024
export const MAX_CACHED_DOCUMENTS = 100

const MAX_REDIRECTS = 3
const MAX_REDIRECT_URIS = 10
const MAX_NAME_LENGTH = 200
const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

const fetchTargetProblem = (target: string, allowedHosts: ReadonlyArray<string>): string | null => {
  if (!URL.canParse(target)) return 'the client_id is not a URL'
  const url = new URL(target)
  if (url.protocol !== 'https:') return 'the client_id must be an https URL'
  if (url.href !== target || target.includes('#') || url.username !== '' || url.password !== '')
    return 'the client_id must be a plain https URL without credentials, fragment or dot segments'
  if (url.port !== '') return 'the client_id must use the default https port'
  if (url.pathname === '/') return 'the client_id must have a path'
  if (!isFetchableHostName(url.hostname)) return 'the client_id must name a public host, not an address'
  if (!allowedHosts.includes(url.hostname)) return `${url.hostname} is not on HB_OAUTH_CLIENT_METADATA_HOSTS`
  return null
}

const documentText = (
  fetch: Fetch,
  clientId: string,
  allowedHosts: ReadonlyArray<string>,
): T.Task<string, ClientMetadataRefused, HasClock> =>
  pipe(
    T.tryPromise(
      async (signal) => {
        let target = clientId
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
          const response = await fetch(target, {
            headers: { accept: 'application/json' },
            redirect: 'manual',
            signal,
          })
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location')
            const next =
              location !== null && URL.canParse(location, target) ? new URL(location, target).href : ''
            if (fetchTargetProblem(next, allowedHosts) !== null)
              throw refused('the document redirects to a place that is not allowed')
            target = next
            continue
          }
          if (!response.ok) throw refused(`the document host answered ${response.status}`)
          if (!/^application\/([a-z.+-]*\+)?json\s*(;|$)/i.test(response.headers.get('content-type') ?? ''))
            throw refused('the document is not served as JSON')
          return await limitedText(response)
        }
        throw refused('the document redirects too many times')
      },
      (cause) =>
        ClientMetadataRefused.is(cause)
          ? cause
          : ClientMetadataRefused({ reason: 'the document could not be fetched' }),
    ),
    T.timeout(FETCH_TIMEOUT_MS),
    T.mapError((error: ClientMetadataRefused | T.TimeoutError) =>
      error._tag === 'TimeoutError'
        ? ClientMetadataRefused({ reason: 'the document host did not answer in time' })
        : error,
    ),
  )

const limitedText = async (response: Response): Promise<string> => {
  if (Number(response.headers.get('content-length') ?? '0') > MAX_DOCUMENT_BYTES)
    throw refused('the document is too large')
  const reader = response.body!.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_DOCUMENT_BYTES) {
      await reader.cancel()
      throw refused('the document is too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const clientFrom = (
  text: string,
  clientId: string,
  redirectHosts: ReadonlyArray<string>,
): Result.Result<RegisteredClient, ClientMetadataRefused> => {
  const document = Result.attempt(
    () => JSON.parse(text) as unknown,
    () => ClientMetadataRefused({ reason: 'the document is not valid JSON' }),
  )
  if (document._tag === 'Err') return document
  const value = document.value
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return Result.err(ClientMetadataRefused({ reason: 'the document is not a JSON object' }))
  const fields = value as Readonly<Record<string, unknown>>
  if (fields.client_id !== clientId)
    return Result.err(ClientMetadataRefused({ reason: 'the document names a different client_id' }))
  if (
    fields.client_secret !== undefined ||
    (fields.token_endpoint_auth_method !== undefined && fields.token_endpoint_auth_method !== 'none')
  )
    return Result.err(ClientMetadataRefused({ reason: 'the document asks for client authentication' }))
  const uris = fields.redirect_uris
  const redirectUris =
    Array.isArray(uris) && uris.every((uri): uri is string => typeof uri === 'string') ? uris : []
  if (
    redirectUris.length === 0 ||
    redirectUris.length > MAX_REDIRECT_URIS ||
    !redirectUris.every((uri) => isAllowedRedirectUri(uri, redirectHosts))
  )
    return Result.err(
      ClientMetadataRefused({ reason: 'the document lists no redirect URI, or one that is not allowed' }),
    )
  const name =
    typeof fields.client_name === 'string' ? fields.client_name.trim().slice(0, MAX_NAME_LENGTH) : ''
  return Result.ok({
    client_id: clientId,
    client_name: name || new URL(clientId).hostname,
    redirect_uris: redirectUris,
  })
}

const refused = (reason: string): ClientMetadataRefused => ClientMetadataRefused({ reason })
