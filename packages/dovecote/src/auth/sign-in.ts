import { createHash } from 'node:crypto'
import { Task as T, tagged } from '@homingbird/kernel'
import { recordAudit } from '../domain/audit.ts'
import { BROWSER_SIGN_IN_CLIENT, issueCredential } from '../domain/credentials.ts'
import { signInMember } from '../domain/members.ts'
import { isAllowedEmail, readSettings } from '../domain/settings.ts'
import type { AppEnv } from '../environment.ts'
import { type RequestEnv, announceDirectoryChange } from '../events/events.ts'
import type { VerifiedIdentity } from './identity-provider.ts'
import { advanceAuthRequest, authRequestById, openAuthRequest } from './requests.ts'

export const SignInRefused = tagged('SignInRefused')<{ readonly message: string }>()
export type SignInRefused = ReturnType<typeof SignInRefused>

export interface Session {
  readonly token: string
  readonly expiresAt: number
  readonly returnTo: string
}

export const beginSignIn = (returnTo: string | undefined): T.Task<string, SignInRefused, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const codeVerifier = env.random.secret()
    const request = yield* openAuthRequest<SignInDetail>({
      kind: 'sign_in',
      lifetimeMs: SIGN_IN_LIFETIME_MS,
      detail: { nonce: env.random.secret(), codeVerifier, returnTo: localPath(returnTo) },
    })
    return yield* T.mapError(refuse)(
      env.identityProvider.authorizationUrl({
        state: request.id,
        nonce: request.detail.nonce,
        codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
        redirectUri: callbackUrl(env.config.publicUrl),
      }),
    )
  })

export const completeSignIn = (
  parameters: { readonly code?: string; readonly state?: string },
  userAgent: string,
): T.Task<Session, SignInRefused, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const request = yield* authRequestById<SignInDetail>('sign_in', parameters.state ?? '')
    const consumed =
      request !== null &&
      (yield* advanceAuthRequest(request.id, { status: 'consumed', expectedStatus: 'pending' }))
    if (request === null || !consumed || !parameters.code)
      return yield* T.fail(SignInRefused({ message: 'This sign-in attempt expired. Please start again.' }))
    const identity = yield* T.mapError(refuse)(
      env.identityProvider.identify({
        code: parameters.code,
        codeVerifier: request.detail.codeVerifier,
        nonce: request.detail.nonce,
        redirectUri: callbackUrl(env.config.publicUrl),
      }),
    )
    yield* requireAllowed(identity)
    const member = yield* signInMember(identity)
    yield* announceDirectoryChange(member.id)
    if (member.status !== 'active')
      return yield* T.fail(
        SignInRefused({ message: 'Your account has been deactivated by an administrator.' }),
      )
    const issued = yield* issueCredential({
      memberId: member.id,
      kind: 'human',
      name: describeBrowser(userAgent),
      client: BROWSER_SIGN_IN_CLIENT,
      lifetimeMs: env.config.sessionDays * DAY_MS,
      refreshable: false,
    })
    const caller = {
      member,
      credential: { id: issued.credentialId, kind: 'human' as const, name: BROWSER_SIGN_IN_CLIENT },
    }
    yield* recordAudit({
      caller,
      action: 'session.signed_in',
      target: member.id,
      detail: { email: member.email },
    })
    return { token: issued.token, expiresAt: issued.tokenExpiresAt, returnTo: request.detail.returnTo }
  })

export const callbackUrl = (publicUrl: string): string => `${publicUrl}/auth/callback`

export const localPath = (returnTo: string | undefined): string =>
  returnTo !== undefined && /^\/(?![/\\])[^\\\s\p{Cc}]*$/u.test(returnTo) ? returnTo : '/'

export const describeBrowser = (userAgent: string): string => {
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Browser'
  const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1]
  return platform === undefined ? browser : `${browser} on ${platform}`
}

interface SignInDetail {
  readonly nonce: string
  readonly codeVerifier: string
  readonly returnTo: string
}

const SIGN_IN_LIFETIME_MS = 10 * 60_000
const DAY_MS = 24 * 60 * 60_000

const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const PLATFORMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
]

const refuse = (error: { readonly message: string }): SignInRefused =>
  SignInRefused({ message: error.message })

const requireAllowed = (identity: VerifiedIdentity): T.Task<void, SignInRefused, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const settings = yield* readSettings
    const domain = identity.email.toLowerCase().split('@').at(-1) ?? ''
    if (!identity.emailVerified)
      return yield* T.fail(
        SignInRefused({ message: 'Your email address has not been verified by the identity provider.' }),
      )
    const acceptsAnyone = env.config.identity.devLogin && settings.allowedDomains.length === 0
    if (!acceptsAnyone && !isAllowedEmail(settings, identity.email))
      return yield* T.fail(
        SignInRefused({ message: `Accounts from ${domain || 'this domain'} are not allowed here.` }),
      )
    if (env.identityProvider.requiresHostedDomain && identity.hostedDomain !== domain)
      return yield* T.fail(
        SignInRefused({ message: 'Sign in with your organization account, not a personal one.' }),
      )
  })
