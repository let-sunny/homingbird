import { createCipheriv, createECDH, hkdfSync } from 'node:crypto'

export interface EncryptionInput {
  readonly plaintext: Buffer
  readonly subscriberPublicKey: Buffer
  readonly subscriberAuthSecret: Buffer
  readonly senderPrivateKey: Buffer
  readonly salt: Buffer
}

export const RECORD_SIZE = 4096
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - 86 - 17

export const encryptPushPayload = (input: EncryptionInput): Buffer => {
  if (input.plaintext.length > MAX_PLAINTEXT_BYTES)
    throw new RangeError('push payload does not fit in one record')
  const sender = createECDH('prime256v1')
  sender.setPrivateKey(input.senderPrivateKey)
  const senderPublicKey = sender.getPublicKey()
  const sharedSecret = sender.computeSecret(input.subscriberPublicKey)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), input.subscriberPublicKey, senderPublicKey])
  const inputKey = derive(sharedSecret, input.subscriberAuthSecret, keyInfo, 32)
  const contentKey = derive(inputKey, input.salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = derive(inputKey, input.salt, Buffer.from('Content-Encoding: nonce\0'), 12)
  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce)
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([input.plaintext, LAST_RECORD_DELIMITER])),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  return Buffer.concat([
    input.salt,
    recordSizeField(),
    Buffer.from([senderPublicKey.length]),
    senderPublicKey,
    sealed,
  ])
}

const LAST_RECORD_DELIMITER = Buffer.from([0x02])

const derive = (inputKey: Buffer, salt: Buffer, info: Buffer, length: number): Buffer =>
  Buffer.from(hkdfSync('sha256', inputKey, salt, info, length))

const recordSizeField = (): Buffer => {
  const field = Buffer.alloc(4)
  field.writeUInt32BE(RECORD_SIZE)
  return field
}
