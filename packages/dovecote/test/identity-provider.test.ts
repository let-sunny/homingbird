import type { JsonWebKey } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import { beforeAll, describe, expect, it } from 'vitest'
import { developmentProvider, verifyIdToken } from '../src/auth/identity-provider.ts'
import { type FakeIssuer, makeFakeIssuer } from './fake-identity-issuer.ts'

const ISSUER = 'https://accounts.google.com'
const NOW = 1_700_000_000
const EXPECTED = { issuer: ISSUER, audience: 'client', nonce: 'n-1', nowSeconds: NOW }
const CLAIMS = { iss: ISSUER, aud: 'client', nonce: 'n-1', sub: '1234', exp: NOW + 600, iat: NOW }

let issuer: FakeIssuer
let keys: ReadonlyArray<JsonWebKey & { kid?: string }>

beforeAll(async () => {
  issuer = makeFakeIssuer(ISSUER)
  keys = ((await (await issuer.fetch(`${ISSUER}/keys`)).json()) as { keys: typeof keys }).keys
})

const verdictOn = (token: string, expected = EXPECTED) => {
  const verified = verifyIdToken(token, keys, expected)
  return verified._tag === 'Ok' ? 'valid' : verified.error.message
}

describe('verifying an ID token', () => {
  it('accepts a token signed with RS256 or ES256 by a published key, for this client and sign-in', () => {
    expect(verdictOn(issuer.signToken(CLAIMS))).toBe('valid')
    expect(verdictOn(issuer.signToken(CLAIMS, { algorithm: 'ES256' }))).toBe('valid')
    expect(verdictOn(issuer.signToken({ ...CLAIMS, aud: ['other', 'client'] }))).toBe('valid')
  })

  it('refuses a token that is malformed, tampered with, or signed by an unknown key or method', () => {
    expect(verdictOn('only.two')).toBe('The ID token is malformed.')
    expect(verdictOn(issuer.signToken(CLAIMS, { tamper: true }))).toBe('The ID token signature is invalid.')
    expect(verdictOn(issuer.signToken(CLAIMS, { keyId: 'retired' }))).toBe(
      'The ID token was signed with an unknown key.',
    )
    const [, payload, signature] = issuer.signToken(CLAIMS).split('.')
    const none = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
    expect(verdictOn(`${none}.${payload}.${signature}`)).toBe(
      'The ID token uses an unsupported signature algorithm.',
    )
    const array = Buffer.from('"text"').toString('base64url')
    expect(verdictOn(`${array}.${payload}.${signature}`)).toBe('The ID token is malformed.')
  })

  it('refuses a token from another issuer, for another client, or for another sign-in', () => {
    expect(verdictOn(issuer.signToken({ ...CLAIMS, iss: 'https://evil.example' }))).toBe(
      'The ID token came from an unexpected issuer.',
    )
    expect(verdictOn(issuer.signToken({ ...CLAIMS, aud: 'other' }))).toBe(
      'The ID token was issued for another application.',
    )
    expect(verdictOn(issuer.signToken({ ...CLAIMS, nonce: 'replayed' }))).toBe(
      'The ID token does not belong to this sign-in.',
    )
  })

  it('allows a minute of clock skew either way, and no more', () => {
    expect(verdictOn(issuer.signToken({ ...CLAIMS, exp: NOW - 60 }))).toBe('valid')
    expect(verdictOn(issuer.signToken({ ...CLAIMS, exp: NOW - 61 }))).toBe('The ID token has expired.')
    expect(verdictOn(issuer.signToken({ ...CLAIMS, iat: NOW + 61 }))).toBe(
      'The ID token claims to be issued in the future.',
    )
    expect(verdictOn(issuer.signToken({ ...CLAIMS, nbf: NOW + 61 }))).toBe('The ID token is not valid yet.')
    expect(verdictOn(issuer.signToken({ ...CLAIMS, nbf: 'soon' }))).toBe('The ID token is not valid yet.')
  })

  it('needs a subject', () => {
    expect(verdictOn(issuer.signToken({ ...CLAIMS, sub: '' }))).toBe('The ID token has no subject.')
  })
})

describe('the development provider', () => {
  const provider = developmentProvider('http://localhost:8080')
  const code = (form: object) => Buffer.from(JSON.stringify(form)).toString('base64url')
  const identify = (form: object | string) =>
    T.runPromise(
      T.result(
        provider.identify({
          code: typeof form === 'string' ? form : code(form),
          codeVerifier: '',
          nonce: '',
          redirectUri: '',
        }),
      ),
    )

  it('sends the browser to its own form, carrying the state', async () => {
    expect(
      await T.runPromise(
        provider.authorizationUrl({ state: 's 1', nonce: '', codeChallenge: '', redirectUri: '' }),
      ),
    ).toBe('http://localhost:8080/auth/dev?state=s+1')
  })

  it('signs in whoever the form names, and nobody when the form was not filled in', async () => {
    expect(await identify({ email: 'Ana@Example.com', name: '' })).toMatchObject({
      _tag: 'Ok',
      value: {
        subject: 'dev|ana@example.com',
        email: 'Ana@Example.com',
        name: 'Ana@Example.com',
        emailVerified: true,
      },
    })
    for (const unfilled of [{ email: 'not an address' }, 'not base64 json'])
      expect(await identify(unfilled)).toMatchObject({
        _tag: 'Err',
        error: { message: 'The development login form was not filled in correctly.' },
      })
  })
})
