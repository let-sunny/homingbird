import { createHash } from 'node:crypto'
import { Task as T, tagged } from '@homingbird/kernel'
import { Conflict, type ConsentRequest, type DeviceRequest, NotFound } from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import { type Issued, issueCredential, refreshCredential, revokeByToken } from '../domain/credentials.ts'
import type { AppEnv, Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { normalizeUserCode } from '../random.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'
import {
  type AuthRequest,
  advanceAuthRequest,
  authRequestById,
  authRequestBySecret,
  authRequestByUserCode,
  openAuthRequest,
} from './requests.ts'

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'invalid_redirect_uri'
  | 'authorization_pending'
  | 'access_denied'
  | 'expired_token'

export const OAuthError = tagged('OAuthError')<{ readonly code: OAuthErrorCode; readonly description: string }>()
export type OAuthError = ReturnType<typeof OAuthError>

export interface TokenResponse {
  readonly access_token: string
  readonly token_type: 'Bearer'
  readonly expires_in: number
  readonly scope: string
  readonly refresh_token?: string
  readonly approval_token?: string
}

export const AGENT_SCOPE = 'notes'
export const APPROVAL_SCOPE = 'approve'
export const DEVICE_CODE_LIFETIME_SECONDS = 600
export const DEVICE_POLL_INTERVAL_SECONDS = 5

// -- Dynamic client registration ------------------------------------------------------------------

export interface RegisteredClient {
  readonly client_id: string
  readonly client_name: string
  readonly redirect_uris: ReadonlyArray<string>
}

export const registerClient = (
  name: string,
  redirectUris: ReadonlyArray<string>,
): T.Task<RegisteredClient, OAuthError, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (redirectUris.length === 0 || redirectUris.length > 10 || !redirectUris.every(isAcceptableRedirectUri))
      return yield* T.fail(
        OAuthError({ code: 'invalid_redirect_uri', description: 'redirect_uris must be https, loopback http, or an app scheme' }),
      )
    const client: RegisteredClient = {
      client_id: `client_${env.random.identifier()}`,
      client_name: name.slice(0, 200) || 'Unnamed client',
      redirect_uris: redirectUris,
    }
    yield* run(
      insertInto('oauth_clients', {
        id: client.client_id,
        name: client.client_name,
        redirect_uris: JSON.stringify(client.redirect_uris),
        created_at: env.clock.now(),
      }),
    )
    return client
  })

// -- Authorization code with PKCE -----------------------------------------------------------------

export interface AuthorizationParameters {
  readonly response_type?: string
  readonly client_id?: string
  readonly redirect_uri?: string
  readonly code_challenge?: string
  readonly code_challenge_method?: string
  readonly state?: string
}

export const beginAuthorization = (
  parameters: AuthorizationParameters,
): T.Task<{ readonly consentId: string }, OAuthError, AppEnv> =>
  T.gen(function* () {
    const client = yield* clientById(parameters.client_id ?? '')
    const redirectUri = parameters.redirect_uri ?? ''
    if (!client.redirect_uris.includes(redirectUri))
      return yield* T.fail(OAuthError({ code: 'invalid_redirect_uri', description: 'redirect_uri is not registered' }))
    if (parameters.response_type !== 'code')
      return yield* T.fail(OAuthError({ code: 'invalid_request', description: 'response_type must be code' }))
    if (parameters.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(parameters.code_challenge ?? ''))
      return yield* T.fail(OAuthError({ code: 'invalid_request', description: 'PKCE with S256 is required' }))
    const opened = yield* openAuthRequest<AuthorizeDetail>({
      kind: 'authorize',
      lifetimeMs: CONSENT_LIFETIME_MS,
      detail: {
        clientId: client.client_id,
        clientName: client.client_name,
        redirectUri,
        codeChallenge: parameters.code_challenge!,
        state: parameters.state ?? null,
        credentialName: null,
      },
    })
    return { consentId: opened.id }
  })

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
      yield* recordAudit({ caller, action: 'oauth.consent.denied', target: request.detail.clientId })
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
    yield* recordAudit({ caller, action: 'oauth.consent.approved', target: request.detail.clientId, detail: { clientName } })
    return { redirectTo: redirectWith(redirectUri, { code, state, iss: env.config.publicUrl }) }
  })

export interface CodeExchange {
  readonly code?: string
  readonly code_verifier?: string
  readonly client_id?: string
  readonly redirect_uri?: string
}

export const exchangeAuthorizationCode = (exchange: CodeExchange): T.Task<TokenResponse, OAuthError, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const request = yield* authRequestBySecret<AuthorizeDetail>('authorize', exchange.code ?? '')
    const invalid = OAuthError({ code: 'invalid_grant', description: 'The authorization code is invalid or expired.' })
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
      lifetimeMs: env.config.agentCredentialDays * DAY_MS,
      refreshable: true,
    })
    yield* recordAudit({
      caller: null,
      action: 'credential.issued',
      target: issued.credentialId,
      detail: { memberId: request.memberId, kind: 'agent', client: request.detail.clientName, grant: 'authorization_code' },
    })
    return tokenResponse(issued, env.clock.now(), AGENT_SCOPE)
  })

export const exchangeRefreshToken = (refreshToken: string): T.Task<TokenResponse, OAuthError, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const issued = yield* T.mapError(() =>
      OAuthError({ code: 'invalid_grant', description: 'The refresh token is invalid, expired or revoked.' }),
    )(refreshCredential(refreshToken))
    return tokenResponse(issued, env.clock.now(), AGENT_SCOPE)
  })

export const revokeToken = revokeByToken

// -- Device authorization -------------------------------------------------------------------------

export interface DeviceAuthorization {
  readonly device_code: string
  readonly user_code: string
  readonly verification_uri: string
  readonly verification_uri_complete: string
  readonly expires_in: number
  readonly interval: number
}

export const beginDeviceAuthorization = (
  clientName: string,
  scope: string,
): T.Task<DeviceAuthorization, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const deviceCode = env.random.secret()
    const userCode = env.random.userCode()
    yield* openAuthRequest<DeviceDetail>({
      kind: 'device',
      secret: deviceCode,
      userCode,
      lifetimeMs: DEVICE_CODE_LIFETIME_SECONDS * 1000,
      detail: {
        client: clientName.slice(0, 200) || 'Unnamed device',
        wantsApproval: scope.split(/\s+/).includes(APPROVAL_SCOPE),
        allowApproval: false,
        credentialName: null,
      },
    })
    const verificationUri = `${env.config.publicUrl}/#/device`
    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}/${userCode}`,
      expires_in: DEVICE_CODE_LIFETIME_SECONDS,
      interval: DEVICE_POLL_INTERVAL_SECONDS,
    }
  })

export const describeDeviceRequest = (userCode: string): T.Task<DeviceRequest, NotFound, AppEnv> =>
  T.gen(function* () {
    const request = yield* pendingDevice(userCode)
    return {
      userCode: request.userCode!,
      client: request.detail.client,
      wantsApproval: request.detail.wantsApproval,
      expiresAt: request.expiresAt,
    }
  })

export const decideDeviceRequest = (
  caller: Caller,
  userCode: string,
  decision: { readonly approve: boolean; readonly name?: string; readonly allowApproval?: boolean },
): T.Task<void, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const request = yield* pendingDevice(userCode)
    const allowApproval = decision.approve && request.detail.wantsApproval && decision.allowApproval === true
    const advanced = yield* advanceAuthRequest(request.id, {
      status: decision.approve ? 'approved' : 'denied',
      expectedStatus: 'pending',
      memberId: caller.member.id,
      detail: { ...request.detail, allowApproval, credentialName: decision.name ?? request.detail.client },
    })
    if (!advanced) return yield* T.fail(Conflict({ message: 'This request was already decided.' }))
    yield* recordAudit({
      caller,
      action: decision.approve ? 'device.approved' : 'device.denied',
      target: request.id,
      detail: { client: request.detail.client, allowApproval },
    })
  })

export const exchangeDeviceCode = (deviceCode: string): T.Task<TokenResponse, OAuthError, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const request = yield* authRequestBySecret<DeviceDetail>('device', deviceCode)
    if (request === null)
      return yield* T.fail(OAuthError({ code: 'expired_token', description: 'The device code is unknown or expired.' }))
    if (request.status === 'pending')
      return yield* T.fail(OAuthError({ code: 'authorization_pending', description: 'Waiting for approval.' }))
    if (request.status === 'denied')
      return yield* T.fail(OAuthError({ code: 'access_denied', description: 'The request was denied.' }))
    const consumed = yield* advanceAuthRequest(request.id, { status: 'consumed', expectedStatus: 'approved' })
    if (!consumed || request.memberId === null)
      return yield* T.fail(OAuthError({ code: 'invalid_grant', description: 'The device code was already used.' }))
    const name = request.detail.credentialName ?? request.detail.client
    const lifetimeMs = env.config.agentCredentialDays * DAY_MS
    const shared = { memberId: request.memberId, client: request.detail.client, lifetimeMs, refreshable: false }
    const agent = yield* issueCredential({ ...shared, kind: 'agent', name })
    const approver = request.detail.allowApproval
      ? yield* issueCredential({ ...shared, kind: 'human', name: `${name} (approve button)` })
      : null
    for (const issued of [agent, approver])
      if (issued !== null)
        yield* recordAudit({
          caller: null,
          action: 'credential.issued',
          target: issued.credentialId,
          detail: {
            memberId: request.memberId,
            kind: issued === agent ? 'agent' : 'human',
            client: request.detail.client,
            grant: 'device_code',
          },
        })
    const scope = approver === null ? AGENT_SCOPE : `${AGENT_SCOPE} ${APPROVAL_SCOPE}`
    return { ...tokenResponse(agent, env.clock.now(), scope), ...(approver && { approval_token: approver.token }) }
  })

// -- Internals ------------------------------------------------------------------------------------

interface AuthorizeDetail {
  readonly clientId: string
  readonly clientName: string
  readonly redirectUri: string
  readonly codeChallenge: string
  readonly state: string | null
  readonly credentialName: string | null
}

interface DeviceDetail {
  readonly client: string
  readonly wantsApproval: boolean
  readonly allowApproval: boolean
  readonly credentialName: string | null
}

const CONSENT_LIFETIME_MS = 10 * 60_000
const DAY_MS = 24 * 60 * 60_000

const clientById = (id: string): T.Task<RegisteredClient, OAuthError, AppEnv> =>
  T.gen(function* () {
    const row = yield* first<{ id: string; name: string; redirect_uris: string }>(
      sql`SELECT * FROM oauth_clients WHERE id = ${id}`,
    )
    if (row === null) return yield* T.fail(OAuthError({ code: 'invalid_client', description: 'Unknown client_id.' }))
    return { client_id: row.id, client_name: row.name, redirect_uris: JSON.parse(row.redirect_uris) as string[] }
  })

const pendingConsent = (id: string): T.Task<AuthRequest<AuthorizeDetail>, NotFound, AppEnv> =>
  T.gen(function* () {
    const request = yield* authRequestById<AuthorizeDetail>('authorize', id)
    if (request === null || request.status !== 'pending')
      return yield* T.fail(NotFound({ message: 'This authorization request is unknown, expired or already decided.' }))
    return request
  })

const pendingDevice = (userCode: string): T.Task<AuthRequest<DeviceDetail>, NotFound, AppEnv> =>
  T.gen(function* () {
    const request = yield* authRequestByUserCode<DeviceDetail>(normalizeUserCode(userCode))
    if (request === null || request.status !== 'pending')
      return yield* T.fail(NotFound({ message: 'This code is unknown, expired or already used.' }))
    return request
  })

const tokenResponse = (issued: Issued, now: number, scope: string): TokenResponse => ({
  access_token: issued.token,
  token_type: 'Bearer',
  expires_in: Math.max(1, Math.floor((issued.tokenExpiresAt - now) / 1000)),
  scope,
  ...(issued.refreshToken !== null && { refresh_token: issued.refreshToken }),
})

const challengeOf = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')

const FORBIDDEN_REDIRECT_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:'])

export const isAcceptableRedirectUri = (uri: string): boolean => {
  if (!URL.canParse(uri) || uri.includes('#')) return false
  const { protocol, hostname } = new URL(uri)
  if (protocol === 'https:') return true
  if (protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  return !FORBIDDEN_REDIRECT_SCHEMES.has(protocol)
}

const hostOf = (uri: string): string => {
  const url = new URL(uri)
  return url.host || url.protocol
}

const redirectWith = (uri: string, parameters: Readonly<Record<string, string | null>>): string => {
  const url = new URL(uri)
  for (const [name, value] of Object.entries(parameters)) if (value !== null) url.searchParams.set(name, value)
  return url.toString()
}
