import { createHash, randomBytes, randomInt } from 'node:crypto'

export interface Random {
  readonly identifier: () => string
  readonly secret: () => string
  readonly userCode: () => string
  readonly bytes: (length: number) => Buffer
}

export const cryptoRandom: Random = {
  identifier: () => lowercaseAlphanumeric(20),
  secret: () => randomBytes(32).toString('base64url'),
  userCode: () => {
    const letters = Array.from({ length: 8 }, () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)])
    return `${letters.slice(0, 4).join('')}-${letters.slice(4).join('')}`
  },
  bytes: (length) => randomBytes(length),
}

export const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex')

export const normalizeUserCode = (input: string): string => {
  const letters = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `${letters.slice(0, 4)}-${letters.slice(4, 8)}`
}

const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'

const ALPHANUMERIC = '0123456789abcdefghijklmnopqrstuvwxyz'

const lowercaseAlphanumeric = (length: number): string =>
  Array.from({ length }, () => ALPHANUMERIC[randomInt(ALPHANUMERIC.length)]).join('')
