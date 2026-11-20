import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { SEALING_NONCE_BYTES, openSealed, sealSecret } from '../src/wake/sealing.ts'

const KEY = Buffer.alloc(32, 1)
const OTHER_KEY = Buffer.alloc(32, 2)
const NONCE = Buffer.alloc(SEALING_NONCE_BYTES, 3)

describe('sealing a secret', () => {
  it('opens again with the same key and context, whatever the secret', () => {
    fc.assert(
      fc.property(fc.string(), fc.uint8Array({ minLength: 12, maxLength: 12 }), (secret, nonce) => {
        expect(openSealed(KEY, sealSecret(KEY, secret, 'mem_ana', Buffer.from(nonce)), 'mem_ana')).toBe(
          secret,
        )
      }),
    )
  })

  it('never shows the secret in what it keeps', () => {
    const sealed = sealSecret(KEY, 'Bearer sk-ant-secret', 'mem_ana', NONCE)
    expect(sealed).not.toContain('sk-ant-secret')
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  it('does not open under another key or for another member', () => {
    const sealed = sealSecret(KEY, 'token', 'mem_ana', NONCE)
    expect(openSealed(OTHER_KEY, sealed, 'mem_ana')).toBeNull()
    expect(openSealed(KEY, sealed, 'mem_ben')).toBeNull()
  })

  it('does not open a changed or malformed value', () => {
    const [version, nonce, body, tag] = sealSecret(KEY, 'token', 'mem_ana', NONCE).split('.')
    const flipped = Buffer.from(body!, 'base64url')
    flipped[0] = flipped[0]! ^ 1
    expect(
      openSealed(KEY, [version, nonce, flipped.toString('base64url'), tag].join('.'), 'mem_ana'),
    ).toBeNull()
    expect(openSealed(KEY, ['v2', nonce, body, tag].join('.'), 'mem_ana')).toBeNull()
    expect(openSealed(KEY, [version, nonce, body].join('.'), 'mem_ana')).toBeNull()
    expect(openSealed(KEY, [version, nonce, body, tag, 'more'].join('.'), 'mem_ana')).toBeNull()
    expect(openSealed(KEY, 'not sealed', 'mem_ana')).toBeNull()
  })

  it('seals the same secret differently under a fresh nonce', () => {
    const again = Buffer.alloc(SEALING_NONCE_BYTES, 4)
    expect(sealSecret(KEY, 'token', 'mem_ana', NONCE)).not.toBe(sealSecret(KEY, 'token', 'mem_ana', again))
  })
})
