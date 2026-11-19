import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generateVapidKeys, vapidAuthorization } from '../src/push/vapid.ts'

interface Delivery {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: Buffer
}

const subscriber = () => {
  const keys = createECDH('prime256v1')
  keys.generateKeys()
  const auth = Buffer.from('0123456789abcdef')
  return {
    keys,
    auth,
    subscription: (endpoint: string) => ({
      endpoint,
      keys: { p256dh: keys.getPublicKey('base64url'), auth: auth.toString('base64url') },
    }),
  }
}

const decrypt = (body: Buffer, receiver: ReturnType<typeof subscriber>): string => {
  const salt = body.subarray(0, 16)
  const keyLength = body[20]!
  const senderPublicKey = body.subarray(21, 21 + keyLength)
  const sealed = body.subarray(21 + keyLength)
  const shared = receiver.keys.computeSecret(senderPublicKey)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), receiver.keys.getPublicKey(), senderPublicKey])
  const inputKey = Buffer.from(hkdfSync('sha256', shared, receiver.auth, info, 32))
  const key = Buffer.from(
    hkdfSync('sha256', inputKey, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  )
  const nonce = Buffer.from(hkdfSync('sha256', inputKey, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const decipher = createDecipheriv('aes-128-gcm', key, nonce)
  decipher.setAuthTag(sealed.subarray(sealed.length - 16))
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()])
  return plain.subarray(0, plain.length - 1).toString('utf8')
}

describe('VAPID', () => {
  it('signs a token the push service can verify with the public key', () => {
    const keys = generateVapidKeys()
    const header = vapidAuthorization(keys, {
      audience: 'https://fcm.googleapis.com',
      subject: 'https://hb.example.com',
      expiresAtSeconds: 1234,
    })
    const [, token, publicKey] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!
    expect(publicKey).toBe(keys.publicKey)
    const [head, payload, signature] = token!.split('.')
    expect(JSON.parse(Buffer.from(head!, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1234,
      sub: 'https://hb.example.com',
    })
    const point = Buffer.from(keys.publicKey, 'base64url')
    const key = createPublicKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
    })
    const verified = verify(
      'sha256',
      Buffer.from(`${head}.${payload}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature!, 'base64url'),
    )
    expect(verified).toBe(true)
  })
})
