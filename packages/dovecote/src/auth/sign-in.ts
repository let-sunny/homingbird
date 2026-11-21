import { createHash } from 'node:crypto'
import { Task as T, tagged } from '@homingbird/kernel'
import { isPerson } from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import { BROWSER_SIGN_IN_CLIENT, issueCredential } from '../domain/credentials.ts'
import { isKnownSubject, signInMember } from '../domain/members.ts'
import { featureIsOn, isAllowedEmail, readSettings } from '../domain/settings.ts'
import type { AppEnv } from '../environment.ts'
import { type RequestEnv, announceDirectoryChange } from '../events/events.ts'
import type { VerifiedIdentity } from './identity-provider.ts'
import { INVITE_REFUSED_MESSAGE, recordInviteRedeemed, redeemInvite } from './invites.ts'
import { advanceAuthRequest, authRequestById, openAuthRequest } from './requests.ts'

export const SignInRefused = tagged('SignInRefused')<{
  readonly message: string
  readonly reason: SignInFailure
}>()

/** Why a sign-in was refused, as the audit trail records it: a code, never the address. */
export type SignInFailure =
  | 'expired'
  | 'identity_provider'
  | 'unverified_email'
  | 'domain_refused'
  | 'invite_refused'
  | 'personal_account'
  | 'deactivated'
  | 'not_a_person'
export type SignInRefused = ReturnType<typeof SignInRefused>

export interface Session {
  readonly token: string
  readonly expiresAt: number
  readonly returnTo: string
}

/** Starts a sign-in at the identity provider; `inviteId` names the invite link it was opened from. */
export const beginSignIn = (
  returnTo: string | undefined,
  inviteId?: string,
): T.Task<string, SignInRefused, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const codeVerifier = env.random.secret()
    const request = yield* openAuthRequest<SignInDetail>({
      kind: 'sign_in',
      lifetimeMs: SIGN_IN_LIFETIME_MS,
      detail: {
        nonce: env.random.secret(),
        codeVerifier,
        returnTo: localPath(returnTo),
        ...(inviteId !== undefined && { inviteId }),
      },
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
      return yield* T.fail(
        SignInRefused({ message: 'This sign-in attempt expired. Please start again.', reason: 'expired' }),
      )
    const identity = yield* T.mapError(refuse)(
      env.identityProvider.identify({
        code: parameters.code,
        codeVerifier: request.detail.codeVerifier,
        nonce: request.detail.nonce,
        redirectUri: callbackUrl(env.config.publicUrl),
      }),
    )
    const invited = yield* requireAdmitted(identity, request.detail.inviteId)
    const member = yield* signInMember(identity)
    if (!isPerson(member))
      return yield* T.fail(SignInRefused({ message: 'This account cannot sign in.', reason: 'not_a_person' }))
    yield* announceDirectoryChange(member.id)
    if (member.status !== 'active')
      return yield* T.fail(
        SignInRefused({
          message: 'Your account has been deactivated by an administrator.',
          reason: 'deactivated',
        }),
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
    yield* recordAudit('credential.issued', {
      caller,
      targetId: issued.credentialId,
      detail: { kind: 'human', grant: 'browser', clientKind: 'browser' },
    })
    if (invited !== null) yield* recordInviteRedeemed(invited, member)
    yield* recordAudit('authn.signed_in', { caller, targetId: member.id, detail: {} })
    return { token: issued.token, expiresAt: issued.tokenExpiresAt, returnTo: request.detail.returnTo }
  })

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
  readonly inviteId?: string
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
  SignInRefused({ message: error.message, reason: 'identity_provider' })

/**
 * Lets a verified email in and says which invite it spent, if any. A member the provider already knows
 * by subject comes back whatever their domain; deactivation is checked once the member is read. Anyone
 * else needs an allowed domain or a place in `HB_ADMIN_EMAILS`, and failing those a valid invite, which
 * is spent only then.
 */
const requireAdmitted = (
  identity: VerifiedIdentity,
  inviteId: string | undefined,
): T.Task<string | null, SignInRefused, RequestEnv> =>
  T.gen(function* () {
    if (!identity.emailVerified)
      return yield* T.fail(
        SignInRefused({
          message: 'Your email address has not been verified by the identity provider.',
          reason: 'unverified_email',
        }),
      )
    if (yield* isKnownSubject(identity.subject)) return null
    const allowed = yield* T.result(requireAllowed(identity))
    if (allowed._tag === 'Ok') return null
    if (inviteId === undefined) return yield* T.fail(allowed.error)
    if ((yield* featureIsOn('invites')) && (yield* redeemInvite(inviteId, identity.email))) return inviteId
    return yield* T.fail(SignInRefused({ message: INVITE_REFUSED_MESSAGE, reason: 'invite_refused' }))
  })

/**
 * An address in an allowed domain must come from that organization's account where the provider can
 * tell: a personal Google account can carry a company address.
 */
const requireAllowed = (identity: VerifiedIdentity): T.Task<void, SignInRefused, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const settings = yield* readSettings
    const email = identity.email.toLowerCase()
    const domain = email.split('@').at(-1) ?? ''
    const inAllowedDomain = isAllowedEmail(settings, email)
    const isNamedAdministrator = env.config.adminEmails.includes(email)
    const acceptsAnyone = env.config.identity.devLogin && settings.allowedDomains.length === 0
    if (!acceptsAnyone && !inAllowedDomain && !isNamedAdministrator)
      return yield* T.fail(
        SignInRefused({
          message: `Accounts from ${domain || 'this domain'} are not allowed here.`,
          reason: 'domain_refused',
        }),
      )
    if (inAllowedDomain && env.identityProvider.requiresHostedDomain && identity.hostedDomain !== domain)
      return yield* T.fail(
        SignInRefused({
          message: 'Sign in with your organization account, not a personal one.',
          reason: 'personal_account',
        }),
      )
  })

const callbackUrl = (publicUrl: string): string => `${publicUrl}/auth/callback`
