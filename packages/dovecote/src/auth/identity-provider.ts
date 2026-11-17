import { createPublicKey, verify } from 'node:crypto'
import { Result, Task as T, tagged } from '@homingbird/kernel'
import type { Config } from '../config.ts'

export interface VerifiedIdentity {
  readonly subject: string
  readonly email: string
  readonly emailVerified: boolean
  readonly name: string
  readonly hostedDomain: string | null
}

export interface IdentityProvider {
  readonly requiresHostedDomain: boolean
  readonly authorizationUrl: (request: AuthorizationRequest) => T.Task<string, IdentityError>
  readonly identify: (request: IdentifyRequest) => T.Task<VerifiedIdentity, IdentityError>
}

export interface AuthorizationRequest {
  readonly state: string
  readonly nonce: string
  readonly codeChallenge: string
  readonly redirectUri: string
}

export interface IdentifyRequest {
  readonly code: string
  readonly codeVerifier: string
  readonly nonce: string
  readonly redirectUri: string
}

export const IdentityError = tagged('IdentityError')<{ readonly message: string }>()
export type IdentityError = ReturnType<typeof IdentityError>

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export const openIdConnectProvider = (identity: Config['identity'], fetch: Fetch, now: () => number): IdentityProvider => {
  let discovered: Discovery | null = null
  const discover: T.Task<Discovery, IdentityError> = T.suspend(() =>
    discovered !== null
      ? T.succeed(discovered)
      : T.map((document: Discovery) => (discovered = document))(
          fetchJson<Discovery>(fetch, `${identity.issuer}/.well-known/openid-configuration`),
        ),
  )

  return {
    requiresHostedDomain: identity.issuer === GOOGLE_ISSUER,
    authorizationUrl: (request) =>
      T.map((discovery: Discovery) => {
        const url = new URL(discovery.authorization_endpoint)
        url.search = new URLSearchParams({
          response_type: 'code',
          client_id: identity.clientId,
          redirect_uri: request.redirectUri,
          scope: 'openid email profile',
          state: request.state,
          nonce: request.nonce,
          code_challenge: request.codeChallenge,
          code_challenge_method: 'S256',
          prompt: 'select_account',
        }).toString()
        return url.toString()
      })(discover),
    identify: (request) =>
      T.gen(function* () {
        const discovery = yield* discover
        const tokens = yield* fetchJson<{ id_token?: string }>(fetch, discovery.token_endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: request.code,
            redirect_uri: request.redirectUri,
            client_id: identity.clientId,
            client_secret: identity.clientSecret,
            code_verifier: request.codeVerifier,
          }).toString(),
        })
        const keys = yield* fetchJson<{ keys: ReadonlyArray<JsonWebKey & { kid?: string }> }>(fetch, discovery.jwks_uri)
        const claims = yield* T.fromResult(
          verifyIdToken(tokens.id_token ?? '', keys.keys, {
            issuer: discovery.issuer,
            audience: identity.clientId,
            nonce: request.nonce,
            nowSeconds: Math.floor(now() / 1000),
          }),
        )
        return {
          subject: `${discovery.issuer}|${claims.sub}`,
          email: String(claims.email ?? ''),
          emailVerified: claims.email_verified === true,
          name: String(claims.name ?? claims.email ?? ''),
          hostedDomain: typeof claims.hd === 'string' ? claims.hd.toLowerCase() : null,
        }
      }),
  }
}

export const developmentProvider = (publicUrl: string): IdentityProvider => ({
  requiresHostedDomain: false,
  authorizationUrl: (request) =>
    T.succeed(`${publicUrl}/auth/dev?${new URLSearchParams({ state: request.state }).toString()}`),
  identify: (request) =>
    T.attempt(
      () => {
        const { email, name } = JSON.parse(Buffer.from(request.code, 'base64url').toString('utf8')) as Record<string, string>
        if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('missing email')
        return { subject: `dev|${email.toLowerCase()}`, email, emailVerified: true, name: name || email, hostedDomain: null }
      },
      () => IdentityError({ message: 'The development login form was not filled in correctly.' }),
    ),
})

export interface IdTokenExpectations {
  readonly issuer: string
  readonly audience: string
  readonly nonce: string
  readonly nowSeconds: number
}

export const verifyIdToken = (
  token: string,
  keys: ReadonlyArray<JsonWebKey & { kid?: string }>,
  expected: IdTokenExpectations,
) =>
  Result.attempt(() => {
    const [headerPart, payloadPart, signaturePart] = token.split('.')
    if (!headerPart || !payloadPart || !signaturePart) throw new Error('The ID token is malformed.')
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as { alg?: string; kid?: string }
    const algorithm = SIGNATURE_ALGORITHMS[header.alg ?? '']
    if (algorithm === undefined) throw new Error('The ID token uses an unsupported signature algorithm.')
    const key = keys.find((candidate) => candidate.kid === header.kid) ?? (keys.length === 1 ? keys[0] : undefined)
    if (key === undefined) throw new Error('The ID token was signed with an unknown key.')
    const signed = verify(
      algorithm.digest,
      Buffer.from(`${headerPart}.${payloadPart}`),
      { key: createPublicKey({ key, format: 'jwk' }), ...algorithm.options },
      Buffer.from(signaturePart, 'base64url'),
    )
    if (!signed) throw new Error('The ID token signature is invalid.')
    const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (claims.iss !== expected.issuer) throw new Error('The ID token came from an unexpected issuer.')
    if (!audiences.includes(expected.audience)) throw new Error('The ID token was issued for another application.')
    if (claims.nonce !== expected.nonce) throw new Error('The ID token does not belong to this sign-in.')
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < expected.nowSeconds)
      throw new Error('The ID token has expired.')
    if (typeof claims.sub !== 'string' || claims.sub === '') throw new Error('The ID token has no subject.')
    return claims as Record<string, unknown> & { sub: string }
  }, toIdentityError)

const toIdentityError = (cause: unknown): IdentityError => IdentityError({ message: (cause as Error).message })

const GOOGLE_ISSUER = 'https://accounts.google.com'
const CLOCK_SKEW_SECONDS = 60

interface Discovery {
  readonly issuer: string
  readonly authorization_endpoint: string
  readonly token_endpoint: string
  readonly jwks_uri: string
}

const SIGNATURE_ALGORITHMS: Readonly<Record<string, { digest: string; options: object }>> = {
  RS256: { digest: 'RSA-SHA256', options: {} },
  ES256: { digest: 'SHA256', options: { dsaEncoding: 'ieee-p1363' } },
}

const fetchJson = <A>(fetch: Fetch, url: string, init?: RequestInit): T.Task<A, IdentityError> =>
  T.tryPromise(
    async (signal) => {
      const response = await fetch(url, { ...init, signal })
      if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`)
      return (await response.json()) as A
    },
    (cause) => IdentityError({ message: `The identity provider could not be reached: ${(cause as Error).message}` }),
  )
