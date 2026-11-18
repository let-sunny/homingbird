import { Task as T } from '@homingbird/kernel'
import { API_PREFIX, STREAM_PATHS } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { handleAgentRequest } from './agent-routes.ts'
import { handleApiRequest } from './api-routes.ts'
import { handleEventStreamRequest } from './event-routes.ts'
import { type HttpRequest, type HttpResponse, json, noContent, withHeaders } from './exchange.ts'
import { handleOAuthRequest } from './oauth-routes.ts'
import { handleSignInRequest } from './sign-in-routes.ts'
import { handleStaticRequest } from './static-routes.ts'

export const handleRequest = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> => {
  const { path } = request
  if (path === '/healthz') return T.succeed(json(200, { status: 'ok' }))
  if (isOpenToOtherOrigins(path)) return openToOtherOrigins(request)
  if (path === STREAM_PATHS.sse) return handleEventStreamRequest(request)
  if (path.startsWith(`${API_PREFIX}/`)) return handleApiRequest(request)
  if (path.startsWith('/auth/')) return handleSignInRequest(request)
  return handleStaticRequest(request)
}

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
