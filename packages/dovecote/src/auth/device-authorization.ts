import { Task as T } from '@homingbird/kernel'
import { type ClientKind, Conflict, type DeviceRequest, NotFound } from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import { issueCredential } from '../domain/credentials.ts'
import type { AppEnv, Caller } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { normalizeUserCode } from '../random.ts'
import {
  AGENT_SCOPE,
  OAuthError,
  type TokenResponse,
  agentCredentialLifetimeMs,
  tokenResponse,
} from './oauth.ts'
import {
  type AuthRequest,
  advanceAuthRequest,
  authRequestBySecret,
  authRequestByUserCode,
  openAuthRequest,
} from './requests.ts'

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
  clientKind: ClientKind = 'device',
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
        clientKind,
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
      expiresAt: request.expiresAt,
    }
  })

export const decideDeviceRequest = (
  caller: Caller,
  userCode: string,
  decision: { readonly approve: boolean; readonly name?: string },
): T.Task<void, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const request = yield* pendingDevice(userCode)
    const advanced = yield* advanceAuthRequest(request.id, {
      status: decision.approve ? 'approved' : 'denied',
      expectedStatus: 'pending',
      memberId: caller.member.id,
      detail: { ...request.detail, credentialName: decision.name ?? request.detail.client },
    })
    if (!advanced) return yield* T.fail(Conflict({ message: 'This request was already decided.' }))
  })

export const exchangeDeviceCode = (deviceCode: string): T.Task<TokenResponse, OAuthError, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const request = yield* authRequestBySecret<DeviceDetail>('device', deviceCode)
    if (request === null)
      return yield* T.fail(
        OAuthError({ code: 'expired_token', description: 'The device code is unknown or expired.' }),
      )
    if (request.status === 'pending')
      return yield* T.fail(
        OAuthError({ code: 'authorization_pending', description: 'Waiting for approval.' }),
      )
    if (request.status === 'denied')
      return yield* T.fail(OAuthError({ code: 'access_denied', description: 'The request was denied.' }))
    const consumed = yield* advanceAuthRequest(request.id, { status: 'consumed', expectedStatus: 'approved' })
    if (!consumed || request.memberId === null)
      return yield* T.fail(
        OAuthError({ code: 'invalid_grant', description: 'The device code was already used.' }),
      )
    const issued = yield* issueCredential({
      memberId: request.memberId,
      kind: 'agent',
      name: request.detail.credentialName ?? request.detail.client,
      client: request.detail.client,
      lifetimeMs: agentCredentialLifetimeMs(env.config.agentCredentialDays),
      refreshable: false,
    })
    yield* recordAudit('credential.issued', {
      actorId: request.memberId,
      targetId: issued.credentialId,
      detail: { kind: 'agent', grant: 'device_code', clientKind: request.detail.clientKind ?? 'device' },
    })
    return tokenResponse(issued, env.clock.now(), AGENT_SCOPE)
  })

interface DeviceDetail {
  readonly client: string
  /** Missing on a request a version before client kinds opened. */
  readonly clientKind?: ClientKind
  readonly credentialName: string | null
}

const DEVICE_CODE_LIFETIME_SECONDS = 600
const DEVICE_POLL_INTERVAL_SECONDS = 5

const pendingDevice = (userCode: string): T.Task<AuthRequest<DeviceDetail>, NotFound, AppEnv> =>
  T.gen(function* () {
    const request = yield* authRequestByUserCode<DeviceDetail>(normalizeUserCode(userCode))
    if (request === null || request.status !== 'pending')
      return yield* T.fail(NotFound({ message: 'This code is unknown, expired or already used.' }))
    return request
  })
