import { Task as T, tagged } from '@homingbird/kernel'
import { type Issued, revokeByToken } from '../domain/credentials.ts'
import { refreshCredential } from '../domain/refresh-tokens.ts'
import type { AppEnv } from '../environment.ts'
import { transact } from '../events/events.ts'

export const OAuthError = tagged('OAuthError')<{
  readonly code: OAuthErrorCode
  readonly description: string
}>()
export type OAuthError = ReturnType<typeof OAuthError>

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'invalid_redirect_uri'
  | 'authorization_pending'
  | 'access_denied'
  | 'expired_token'

export interface TokenResponse {
  readonly access_token: string
  readonly token_type: 'Bearer'
  readonly expires_in: number
  readonly scope: string
  readonly refresh_token?: string
}

export const AGENT_SCOPE = 'notes'

export const exchangeRefreshToken = (refreshToken: string): T.Task<TokenResponse, OAuthError, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const refresh = yield* transact(refreshCredential(refreshToken))
    if (refresh.outcome !== 'issued')
      return yield* T.fail(
        OAuthError({
          code: 'invalid_grant',
          description: 'The refresh token is invalid, expired or revoked.',
        }),
      )
    return tokenResponse(refresh.issued, env.clock.now(), AGENT_SCOPE)
  })

export const revokeToken = revokeByToken

export const tokenResponse = (issued: Issued, now: number, scope: string): TokenResponse => ({
  access_token: issued.token,
  token_type: 'Bearer',
  expires_in: Math.max(1, Math.floor((issued.tokenExpiresAt - now) / 1000)),
  scope,
  ...(issued.refreshToken !== null && { refresh_token: issued.refreshToken }),
})

export const agentCredentialLifetimeMs = (days: number): number => days * DAY_MS

const DAY_MS = 24 * 60 * 60_000
