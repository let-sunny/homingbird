import { Task as T } from '@homingbird/kernel'
import {
  type ClientKind,
  type Conflict,
  FEATURE_OFF_MESSAGE,
  Forbidden,
  JOIN_CODE_LIFETIME_SECONDS,
  type JoinCode,
  type MemberId,
  NotFound,
} from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import { agentToIssue, mayStillIssue } from '../domain/channel-agents.ts'
import { issueCredential } from '../domain/credentials.ts'
import { memberById } from '../domain/members.ts'
import { featureIsOn } from '../domain/settings.ts'
import { type Caller, isHuman } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import {
  AGENT_SCOPE,
  OAuthError,
  type TokenResponse,
  agentCredentialLifetimeMs,
  tokenResponse,
} from './oauth.ts'
import { advanceAuthRequest, authRequestBySecret, openAuthRequest } from './requests.ts'

/** A single-use code for `homingbird setup`, stored as a hash and shown in this response alone. */
export const createJoinCode = (
  caller: Caller,
  channel: string | undefined,
): T.Task<JoinCode, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!isHuman(caller))
      return yield* T.fail(
        Forbidden({ message: 'Only a person signed in to the web client creates a join code.' }),
      )
    if (channel !== undefined && !(yield* featureIsOn('channelAgents')))
      return yield* T.fail(NotFound({ message: FEATURE_OFF_MESSAGE }))
    const agentId = channel === undefined ? null : yield* agentToIssue(caller, channel)
    const code = `${JOIN_CODE_PREFIX}${env.random.secret()}`
    const opened = yield* openAuthRequest<JoinDetail>({
      kind: 'join',
      secret: code,
      memberId: agentId ?? caller.member.id,
      lifetimeMs: JOIN_CODE_LIFETIME_SECONDS * 1000,
      detail: { createdBy: caller.member.id },
    })
    return {
      code,
      serverUrl: env.config.publicUrl,
      expiresAt: opened.expiresAt,
      expiresInSeconds: JOIN_CODE_LIFETIME_SECONDS,
    }
  })

/** Exchanges a join code once for its agent credential; every refusal reads the same. */
export const redeemJoinCode = (
  code: string,
  clientName: string,
  clientKind: ClientKind,
): T.Task<TokenResponse, OAuthError, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!code.startsWith(JOIN_CODE_PREFIX)) return yield* T.fail(REFUSED)
    const request = yield* authRequestBySecret<JoinDetail>('join', code)
    if (request === null || request.status !== 'pending' || request.memberId === null)
      return yield* T.fail(REFUSED)
    if (!(yield* advanceAuthRequest(request.id, { status: 'consumed', expectedStatus: 'pending' })))
      return yield* T.fail(REFUSED)
    const memberId = request.memberId
    const createdBy = request.detail.createdBy
    const forAgent = memberId !== createdBy
    if (!(yield* isActive(createdBy))) return yield* T.fail(REFUSED)
    if (forAgent && !((yield* featureIsOn('channelAgents')) && (yield* mayStillIssue(memberId, createdBy))))
      return yield* T.fail(REFUSED)
    const name = clientName.slice(0, 200) || 'Homingbird setup'
    const issued = yield* issueCredential({
      memberId,
      kind: 'agent',
      name,
      client: name,
      lifetimeMs: agentCredentialLifetimeMs(env.config.agentCredentialDays),
      refreshable: false,
      ...(forAgent && { issuedBy: createdBy }),
    })
    yield* recordAudit('credential.issued', {
      actorId: createdBy,
      targetId: issued.credentialId,
      detail: {
        kind: 'agent',
        grant: 'join_code',
        clientKind,
        ...(forAgent && { channelAgent: memberId }),
      },
    })
    return tokenResponse(issued, env.clock.now(), AGENT_SCOPE)
  })

export const JOIN_CODE_REFUSED =
  'This join code is unknown, expired or already used. Create a new one in the web client.'

const JOIN_CODE_PREFIX = 'hbj_'

interface JoinDetail {
  readonly createdBy: MemberId
}

const REFUSED = OAuthError({ code: 'invalid_grant', description: JOIN_CODE_REFUSED })

const isActive = (id: MemberId): T.Task<boolean, never, RequestEnv> =>
  T.fold(
    () => false,
    (member: { readonly status: string }) => member.status === 'active',
  )(memberById(id))
