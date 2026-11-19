import { describe, expect, it } from 'vitest'
import { cryptoRandom, hashSecret, normalizeUserCode } from '../src/random.ts'

describe('the random service', () => {
  it('makes lower-case identifiers, long secrets and user codes without vowels', () => {
    expect(cryptoRandom.identifier()).toMatch(/^[0-9a-z]{20}$/)
    expect(cryptoRandom.secret()).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(cryptoRandom.userCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
    expect(cryptoRandom.bytes(16)).toHaveLength(16)
    expect(new Set(Array.from({ length: 50 }, () => cryptoRandom.secret())).size).toBe(50)
  })

  it('hashes a secret the same way every time, never returning it', () => {
    expect(hashSecret('hbh_secret')).toBe(hashSecret('hbh_secret'))
    expect(hashSecret('hbh_secret')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSecret('hbh_secret')).not.toContain('secret')
  })

  it('reads a user code however the person typed it', () => {
    expect(normalizeUserCode('bcdf ghjk')).toBe('BCDF-GHJK')
    expect(normalizeUserCode('BCDF-GHJK')).toBe('BCDF-GHJK')
    expect(normalizeUserCode('bc-df-gh-jk-extra')).toBe('BCDF-GHJK')
  })
})
