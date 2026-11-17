import { agentCard, handleA2aMessage } from '@homingbird/a2a'
import { Task as T } from '@homingbird/kernel'
import { handleMcpMessage } from '@homingbird/mcp'
import type { Unauthorized } from '@homingbird/protocol'
import { localApi } from '../api/invoke.ts'
import type { AppEnv, Caller } from '../environment.ts'
import { SERVER_VERSION } from '../version.ts'
import { bearerCallerOf } from './authenticate.ts'
import {
  type HttpRequest,
  type HttpResponse,
  INVALID_JSON,
  apiFailure,
  json,
  noContent,
  parseJson,
  text,
} from './exchange.ts'
import { resourceMetadataUrl } from './oauth-routes.ts'

export const handleAgentRequest = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (request.method === 'GET' && request.path === '/.well-known/agent-card.json')
      return json(200, agentCard(env.config.publicUrl, SERVER_VERSION))
    if (request.method !== 'POST') return text(405, 'Method not allowed.')
    const caller = yield* T.result(bearerCallerOf(request))
    if (caller._tag === 'Err') return challenge(caller.error, env.config.publicUrl)
    const message = parseJson(request.body)
    if (message === INVALID_JSON) return json(400, PARSE_ERROR)
    const reply = yield* answer(request.path, message, caller.value, env)
    return reply === null ? noContent() : json(200, reply)
  })

const answer = (path: string, message: unknown, caller: Caller, env: AppEnv): T.Task<unknown | null> => {
  const api = localApi(caller, env)
  const nonce = env.random.identifier
  return path === '/mcp'
    ? handleMcpMessage(message, {
        api,
        serverVersion: SERVER_VERSION,
        nonce,
        webClientUrl: env.config.publicUrl,
      })
    : handleA2aMessage(message, { api, publicUrl: env.config.publicUrl, nonce })
}

const challenge = (error: Unauthorized, publicUrl: string): HttpResponse =>
  apiFailure(error, { 'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl(publicUrl)}"` })

const PARSE_ERROR = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }
