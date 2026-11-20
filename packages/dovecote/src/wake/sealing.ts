import { createCipheriv, createDecipheriv } from 'node:crypto'

/** AES-256-GCM with `context` as associated data, so a value copied to another row does not open. */
export const sealSecret = (key: Buffer, plaintext: string, context: string, nonce: Buffer): string => {
  const cipher = createCipheriv(ALGORITHM, key, nonce)
  cipher.setAAD(Buffer.from(context, 'utf8'))
  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, nonce, sealed, cipher.getAuthTag()]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.')
}

export const openSealed = (key: Buffer, sealed: string, context: string): string | null => {
  const [version, nonce, body, tag, ...rest] = sealed.split('.')
  if (
    version !== VERSION ||
    nonce === undefined ||
    body === undefined ||
    tag === undefined ||
    rest.length > 0
  )
    return null
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(nonce, 'base64url'))
    decipher.setAAD(Buffer.from(context, 'utf8'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export const SEALING_NONCE_BYTES = 12

const ALGORITHM = 'aes-256-gcm'
const VERSION = 'v1'
