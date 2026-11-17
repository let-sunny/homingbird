import { type KeyObject, generateKeyPairSync, sign } from 'node:crypto'
import type { Fetch } from '../src/auth/identity-provider.ts'

export type Algorithm = 'RS256' | 'ES256'

export interface FakeIssuer {
  readonly issuer: string
  readonly fetch: Fetch
  readonly requests: string[]
  nextToken: (authorizationRequest: { readonly nonce: string }) => string
  unreachable: boolean
  readonly signToken: (claims: Readonly<Record<string, unknown>>, options?: SignOptions) => string
}

export interface SignOptions {
  readonly algorithm?: Algorithm
  readonly keyId?: string
  readonly tamper?: boolean
}

export const makeFakeIssuer = (issuer = 'https://accounts.google.com'): FakeIssuer => {
  const keys: Record<Algorithm, { readonly privateKey: KeyObject; readonly publicKey: KeyObject }> = {
    RS256: generateKeyPairSync('rsa', { modulusLength: 2048 }),
    ES256: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
  }
  const signToken: FakeIssuer['signToken'] = (claims, options = {}) => {
    const algorithm = options.algorithm ?? 'RS256'
    const header = encode({ alg: algorithm, kid: options.keyId ?? algorithm })
    const payload = encode(claims)
    const signature = sign(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      algorithm === 'ES256'
        ? { key: keys.ES256.privateKey, dsaEncoding: 'ieee-p1363' }
        : keys.RS256.privateKey,
    )
    if (options.tamper) signature[0] = signature[0]! ^ 0xff
    return `${header}.${payload}.${signature.toString('base64url')}`
  }
  const fake: FakeIssuer = {
    issuer,
    requests: [],
    unreachable: false,
    signToken,
    nextToken: () => {
      throw new Error('set nextToken before signing in')
    },
    fetch: async (url, init) => {
      fake.requests.push(url)
      if (fake.unreachable) return new Response('down', { status: 503 })
      if (url === `${issuer}/.well-known/openid-configuration`)
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/keys`,
        })
      if (url === `${issuer}/keys`)
        return Response.json({
          keys: (['RS256', 'ES256'] as const).map((kid) => ({
            ...keys[kid].publicKey.export({ format: 'jwk' }),
            kid,
          })),
        })
      if (url === `${issuer}/token`) {
        const form = new URLSearchParams(String(init?.body))
        const nonce = Buffer.from(form.get('code') ?? '', 'base64url').toString('utf8')
        return Response.json({ id_token: fake.nextToken({ nonce }) })
      }
      return new Response('not found', { status: 404 })
    },
  }
  return fake
}

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
