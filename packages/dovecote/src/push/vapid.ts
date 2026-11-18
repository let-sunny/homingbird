import { createECDH, createPrivateKey, sign } from 'node:crypto'
import { Task as T } from '@homingbird/kernel'
import type { AppEnv } from '../environment.ts'
import { first, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'

export interface VapidKeys {
  readonly publicKey: string
  readonly privateKey: string
}

export const vapidKeys: T.Task<VapidKeys, never, AppEnv> = T.gen(function* () {
  const stored = yield* first<{ value: string }>(sql`SELECT value FROM settings WHERE name = ${VAPID_ROW}`)
  if (stored !== null) return JSON.parse(stored.value) as VapidKeys
  const generated = generateVapidKeys()
  yield* run(insertInto('settings', { name: VAPID_ROW, value: JSON.stringify(generated) }))
  return generated
})

export const generateVapidKeys = (): VapidKeys => {
  const pair = createECDH('prime256v1')
  pair.generateKeys()
  return { publicKey: pair.getPublicKey('base64url'), privateKey: pair.getPrivateKey('base64url') }
}

export interface VapidClaims {
  readonly audience: string
  readonly subject: string
  readonly expiresAtSeconds: number
}

export const vapidAuthorization = (keys: VapidKeys, claims: VapidClaims): string => {
  const header = encode({ typ: 'JWT', alg: 'ES256' })
  const payload = encode({ aud: claims.audience, exp: claims.expiresAtSeconds, sub: claims.subject })
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKeyObject(keys),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  return `vapid t=${header}.${payload}.${signature}, k=${keys.publicKey}`
}

const VAPID_ROW = 'vapid'

const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')

const privateKeyObject = (keys: VapidKeys) => {
  const publicPoint = Buffer.from(keys.publicKey, 'base64url')
  return createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: publicPoint.subarray(1, 33).toString('base64url'),
      y: publicPoint.subarray(33, 65).toString('base64url'),
    },
  })
}
