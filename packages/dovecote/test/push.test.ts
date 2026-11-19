import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MAX_PLAINTEXT_BYTES, encryptPushPayload } from '../src/push/payload-encryption.ts'

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

describe('payload encryption', () => {
  it('refuses a payload that does not fit in one record', () => {
    const receiver = subscriber()
    const sender = createECDH('prime256v1')
    sender.generateKeys()
    const input = {
      subscriberPublicKey: receiver.keys.getPublicKey(),
      subscriberAuthSecret: receiver.auth,
      senderPrivateKey: sender.getPrivateKey(),
      salt: Buffer.alloc(16, 7),
    }
    expect(() => encryptPushPayload({ ...input, plaintext: Buffer.alloc(MAX_PLAINTEXT_BYTES + 1) })).toThrow(
      RangeError,
    )
    const body = encryptPushPayload({ ...input, plaintext: Buffer.from('fits') })
    expect(decrypt(body, receiver)).toBe('fits')
  })
})
