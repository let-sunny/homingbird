import { createHash } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import { Conflict, type ConsentRequest, NotFound } from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import { issueCredential } from '../domain/credentials.ts'
import type { AppEnv, Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { type RegisteredClient, hostOf, requireClient } from './oauth-clients.ts'
import {
  AGENT_SCOPE,
  OAuthError,
  type TokenResponse,
  agentCredentialLifetimeMs,
  tokenResponse,
} from './oauth.ts'
import { isAllowedRedirectUri, matchingRedirectUri } from './redirect-policy.ts'
import {
  type AuthRequest,
  advanceAuthRequest,
  authRequestById,
  authRequestBySecret,
  openAuthRequest,
} from './requests.ts'

export interface AuthorizationParameters {
  readonly response_type?: string
  readonly client_id?: string
  readonly redirect_uri?: string
  readonly code_challenge?: string
  readonly code_challenge_method?: string
  readonly state?: string
}

export interface CheckedAuthorization {
  readonly client: RegisteredClient
  readonly redirectUri: string
  readonly codeChallenge: string
  readonly state: string | null
}

export const requireAuthorization = (
  parameters: AuthorizationParameters,
): T.Task<CheckedAuthorization, OAuthError, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const client = yield* requireClient(parameters.client_id ?? '')
    const redirectUri = matchingRedirectUri(client.redirect_uris, parameters.redirect_uri ?? '')
    if (redirectUri === null)
      return yield* T.fail(
        OAuthError({ code: 'invalid_redirect_uri', description: 'redirect_uri is not registered' }),
      )
    if (!client.configured && !isAllowedRedirectUri(redirectUri, env.config.oauth.redirectHosts))
      return yield* T.fail(
        OAuthError({
          code: 'invalid_redirect_uri',
          description: 'redirect_uri is not allowed on this server',
        }),
      )
    if (parameters.response_type !== 'code')
      return yield* T.fail(OAuthError({ code: 'invalid_request', description: 'response_type must be code' }))
    if (
      parameters.code_challenge_method !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(parameters.code_challenge ?? '')
    )
      return yield* T.fail(OAuthError({ code: 'invalid_request', description: 'PKCE with S256 is required' }))
    return {
      client: {
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
      },
      redirectUri,
      codeChallenge: parameters.code_challenge!,
      state: parameters.state ?? null,
    }
  })

export const openConsent = (
  checked: CheckedAuthorization,
): T.Task<{ readonly consentId: string }, never, AppEnv> =>
  T.map((opened: AuthRequest<AuthorizeDetail>) => ({ consentId: opened.id }))(
    openAuthRequest<AuthorizeDetail>({
      kind: 'authorize',
      lifetimeMs: CONSENT_LIFETIME_MS,
      detail: {
        clientId: checked.client.client_id,
        clientName: checked.client.client_name,
        redirectUri: checked.redirectUri,
        codeChallenge: checked.codeChallenge,
        state: checked.state,
        credentialName: null,
      },
    }),
  )

export const describeConsent = (id: string): T.Task<ConsentRequest, NotFound, AppEnv> =>
  T.gen(function* () {
    const request = yield* pendingConsent(id)
    return {
      id: request.id,
      client: request.detail.clientName,
      redirectHost: hostOf(request.detail.redirectUri),
      expiresAt: request.expiresAt,
    }
  })

export const decideConsent = (
  caller: Caller,
  id: string,
  decision: { readonly approve: boolean; readonly name?: string },
): T.Task<{ redirectTo: string }, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const request = yield* pendingConsent(id)
    const { redirectUri, state, clientName } = request.detail
    if (!decision.approve) {
      yield* advanceAuthRequest(id, { status: 'denied', expectedStatus: 'pending' })
      return { redirectTo: redirectWith(redirectUri, { error: 'access_denied', state }) }
    }
    const code = env.random.secret()
    const advanced = yield* advanceAuthRequest(id, {
      status: 'approved',
      expectedStatus: 'pending',
      memberId: caller.member.id,
      secret: code,
      detail: { ...request.detail, credentialName: decision.name ?? clientName },
    })
    if (!advanced) return yield* T.fail(Conflict({ message: 'This request was already decided.' }))
    return { redirectTo: redirectWith(redirectUri, { code, state, iss: env.config.publicUrl }) }
  })

export interface CodeExchange {
  readonly code?: string
  readonly code_verifier?: string
  readonly client_id?: string
  readonly redirect_uri?: string
}

export const exchangeAuthorizationCode = (
  exchange: CodeExchange,
): T.Task<TokenResponse, OAuthError, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const request = yield* authRequestBySecret<AuthorizeDetail>('authorize', exchange.code ?? '')
    const invalid = OAuthError({
      code: 'invalid_grant',
      description: 'The authorization code is invalid or expired.',
    })
    if (request === null || request.memberId === null) return yield* T.fail(invalid)
    const matches =
      request.detail.clientId === exchange.client_id &&
      request.detail.redirectUri === exchange.redirect_uri &&
      challengeOf(exchange.code_verifier ?? '') === request.detail.codeChallenge
    const consumed = yield* advanceAuthRequest(request.id, { status: 'consumed', expectedStatus: 'approved' })
    if (!matches || !consumed) return yield* T.fail(invalid)
    const issued = yield* issueCredential({
      memberId: request.memberId,
      kind: 'agent',
      name: request.detail.credentialName ?? request.detail.clientName,
      client: request.detail.clientName,
      lifetimeMs: agentCredentialLifetimeMs(env.config.agentCredentialDays),
      refreshable: true,
    })
    yield* recordAudit('credential.issued', {
      actorId: request.memberId,
      targetId: issued.credentialId,
      clientId: request.detail.clientId,
      detail: { kind: 'agent', grant: 'authorization_code', clientKind: 'oauth' },
    })
    return tokenResponse(issued, env.clock.now(), AGENT_SCOPE)
  })

interface AuthorizeDetail {
  readonly clientId: string
  readonly clientName: string
  readonly redirectUri: string
  readonly codeChallenge: string
  readonly state: string | null
  readonly credentialName: string | null
}

const CONSENT_LIFETIME_MS = 10 * 60_000

const pendingConsent = (id: string): T.Task<AuthRequest<AuthorizeDetail>, NotFound, AppEnv> =>
  T.gen(function* () {
    const request = yield* authRequestById<AuthorizeDetail>('authorize', id)
    if (request === null || request.status !== 'pending')
      return yield* T.fail(
        NotFound({ message: 'This authorization request is unknown, expired or already decided.' }),
      )
    return request
  })

const challengeOf = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')

const redirectWith = (uri: string, parameters: Readonly<Record<string, string | null>>): string => {
  const url = new URL(uri)
  for (const [name, value] of Object.entries(parameters))
    if (value !== null) url.searchParams.set(name, value)
  return url.toString()
}
