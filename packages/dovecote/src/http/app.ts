import { Task as T } from '@homingbird/kernel'
import { API_PREFIX, STREAM_PATHS } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { defectNameOf, logDefect } from '../log/operational-log.ts'
import { handleAgentRequest } from './agent-routes.ts'
import { handleApiRequest, routeFor } from './api-routes.ts'
import { handleEventStreamRequest } from './event-routes.ts'
import { type HttpRequest, type HttpResponse, json, noContent, withHeaders } from './exchange.ts'
import { handleOAuthRequest } from './oauth-routes.ts'
import { handleSignInRequest } from './sign-in-routes.ts'
import { handleStaticRequest } from './static-routes.ts'

/**
 * Answers one request under its own request id, returned as `X-Request-Id` and shared by every log line
 * and audit row it writes. A defect is logged by name and answered with a 500.
 */
export const handleRequest = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const requestId = `req_${env.random.identifier()}`
    const started = env.clock.now()
    const client = { address: request.remoteAddress, userAgent: request.headers['user-agent'] ?? '' }
    const exit: T.Exit<HttpResponse, never> = yield* T.exit(
      T.provide({ requestId, client })(routed(request)) as T.Task<HttpResponse, never, AppEnv>,
    )
    const route = routeNameOf(request)
    const method = /^[A-Z]{1,10}$/.test(request.method) ? request.method : 'OTHER'
    if (exit._tag === 'Err') {
      if (exit.error._tag !== 'Die') return yield* T.fromExit<HttpResponse, never>(exit)
      const { defect } = exit.error
      logDefect(
        env.log,
        { name: 'http.request_failed', attributes: { route, method, defect: defectNameOf(defect) } },
        defect,
        requestId,
      )
      return withHeaders(
        json(500, { error: { code: 'Unavailable', message: 'The server hit an unexpected error.' } }),
        { [REQUEST_ID_HEADER]: requestId },
      )
    }
    if (env.config.logs.requests)
      env.log.emit(
        {
          name: 'http.request',
          attributes: { route, method, status: exit.value.status, durationMs: env.clock.now() - started },
        },
        requestId,
      )
    return withHeaders(exit.value, { [REQUEST_ID_HEADER]: requestId })
  })

const REQUEST_ID_HEADER = 'x-request-id'

const routed = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> => {
  const { path } = request
  if (path === '/healthz') return T.succeed(json(200, { status: 'ok' }))
  if (isOpenToOtherOrigins(path)) return openToOtherOrigins(request)
  if (path === STREAM_PATHS.sse) return handleEventStreamRequest(request)
  if (path.startsWith(`${API_PREFIX}/`)) return handleApiRequest(request)
  if (path.startsWith('/auth/')) return handleSignInRequest(request)
  return handleStaticRequest(request)
}

/** A route's contract name, or the area a path belongs to: never the path itself, which can carry codes. */
const routeNameOf = (request: HttpRequest): string => {
  if (request.path.startsWith(`${API_PREFIX}/`)) return routeFor(request)?.name ?? 'api.unknown'
  return (
    AREAS.find(([prefix]) => request.path === prefix || request.path.startsWith(`${prefix}/`))?.[1] ??
    'static'
  )
}

const AREAS: ReadonlyArray<readonly [string, string]> = [
  ['/healthz', 'health'],
  [STREAM_PATHS.sse, 'events.stream'],
  ['/auth', 'auth'],
  ['/oauth', 'oauth'],
  ['/.well-known', 'wellKnown'],
  ['/mcp', 'mcp'],
  ['/a2a', 'a2a'],
]

const isOpenToOtherOrigins = (path: string): boolean =>
  path === '/mcp' || path === '/a2a' || path.startsWith('/oauth/') || path.startsWith('/.well-known/')

const openToOtherOrigins = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> => {
  if (request.method === 'OPTIONS') return T.succeed(noContent(CROSS_ORIGIN_HEADERS))
  const isAgentEndpoint =
    request.path === '/mcp' || request.path === '/a2a' || request.path === '/.well-known/agent-card.json'
  const isBrowserNavigation = request.method === 'GET' && request.path === '/oauth/authorize'
  const response = isAgentEndpoint ? handleAgentRequest(request) : handleOAuthRequest(request)
  return isBrowserNavigation
    ? response
    : T.map((r: HttpResponse) => withHeaders(r, CROSS_ORIGIN_HEADERS))(response)
}

const CROSS_ORIGIN_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  'access-control-max-age': '86400',
}
