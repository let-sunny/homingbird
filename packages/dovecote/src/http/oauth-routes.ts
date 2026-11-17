import { Task as T } from '@homingbird/kernel'
import {
  AGENT_SCOPE,
  APPROVAL_SCOPE,
  type OAuthError,
  beginAuthorization,
  beginDeviceAuthorization,
  exchangeAuthorizationCode,
  exchangeDeviceCode,
  exchangeRefreshToken,
  OAuthError as oauthError,
  registerClient,
  revokeToken,
} from '../auth/oauth.ts'
import type { AppEnv } from '../environment.ts'
import { transact } from '../events/events.ts'
import {
  type HttpRequest,
  type HttpResponse,
  INVALID_JSON,
  formFields,
  json,
  parseJson,
  redirect,
  text,
} from './exchange.ts'
import { LIMITS, type Limit } from './rate-limiter.ts'

export const handleOAuthRequest = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const route = `${request.method} ${request.path}`
    if (route === 'GET /.well-known/oauth-authorization-server')
      return json(200, serverMetadata(env.config.publicUrl))
    if (request.method === 'GET' && request.path.startsWith('/.well-known/oauth-protected-resource'))
      return json(200, resourceMetadata(env.config.publicUrl))
    if (route === 'GET /oauth/authorize') return yield* authorize(request)
    if (route === 'POST /oauth/register') return yield* limited(request, 'registration', register(request))
    if (route === 'POST /oauth/token') return yield* limited(request, 'token', token(request))
    if (route === 'POST /oauth/device_authorization')
      return yield* limited(request, 'deviceStart', startDevice(request))
    if (route === 'POST /oauth/revoke') return yield* revoke(request)
    return text(404, 'Not found.')
  })

export const resourceMetadataUrl = (publicUrl: string): string =>
  `${publicUrl}/.well-known/oauth-protected-resource`

const serverMetadata = (publicUrl: string) => ({
  issuer: publicUrl,
  authorization_endpoint: `${publicUrl}/oauth/authorize`,
  token_endpoint: `${publicUrl}/oauth/token`,
  registration_endpoint: `${publicUrl}/oauth/register`,
  device_authorization_endpoint: `${publicUrl}/oauth/device_authorization`,
  revocation_endpoint: `${publicUrl}/oauth/revoke`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token', DEVICE_GRANT],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: [AGENT_SCOPE, APPROVAL_SCOPE],
  authorization_response_iss_parameter_supported: true,
})

const resourceMetadata = (publicUrl: string) => ({
  resource: `${publicUrl}/mcp`,
  authorization_servers: [publicUrl],
  bearer_methods_supported: ['header'],
  scopes_supported: [AGENT_SCOPE],
})

const authorize = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.fold(
    (error: OAuthError) => text(400, `${error.code}: ${error.description}`),
    (begun: { consentId: string }) => redirect(`/#/consent/${begun.consentId}`),
  )(beginAuthorization(Object.fromEntries(request.query)))

const register = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> => {
  const body = parseJson(request.body)
  if (body === INVALID_JSON || typeof body !== 'object' || body === null)
    return T.succeed(
      failure(oauthError({ code: 'invalid_request', description: 'The body must be a JSON object.' })),
    )
  const { client_name: name, redirect_uris: uris } = body as {
    client_name?: unknown
    redirect_uris?: unknown
  }
  const redirectUris = Array.isArray(uris) ? uris.filter((uri): uri is string => typeof uri === 'string') : []
  return T.fold(failure, (client: object) =>
    json(201, {
      ...client,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  )(registerClient(typeof name === 'string' ? name : '', redirectUris))
}

const token = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> => {
  const fields = formFields(request)
  const grant =
    fields.grant_type === 'authorization_code'
      ? transact(exchangeAuthorizationCode(fields))
      : fields.grant_type === 'refresh_token'
        ? exchangeRefreshToken(fields.refresh_token ?? '')
        : fields.grant_type === DEVICE_GRANT
          ? transact(exchangeDeviceCode(fields.device_code ?? ''))
          : T.fail(oauthError({ code: 'unsupported_grant_type', description: 'Unsupported grant_type.' }))
  return T.fold(failure, (tokens: object) => json(200, tokens))(grant)
}

const startDevice = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> => {
  const fields = formFields(request)
  return T.map((authorization: object) => json(200, authorization))(
    beginDeviceAuthorization(fields.client_name ?? fields.client_id ?? '', fields.scope ?? AGENT_SCOPE),
  )
}

const revoke = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.as(json(200, {}))(revokeToken(formFields(request).token ?? ''))

const limited = (
  request: HttpRequest,
  limit: keyof typeof LIMITS,
  response: T.Task<HttpResponse, never, AppEnv>,
): T.Task<HttpResponse, never, AppEnv> =>
  T.flatMap((env: AppEnv) =>
    env.rateLimiter.allow(`${limit}:${request.remoteAddress}`, LIMITS[limit] as Limit)
      ? response
      : T.succeed(json(429, { error: 'slow_down', error_description: 'Too many requests.' })),
  )(T.ask<AppEnv>())

const failure = (error: OAuthError): HttpResponse =>
  json(error.code === 'invalid_client' ? 401 : 400, {
    error: error.code,
    error_description: error.description,
  })

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
