import { describe, expect, it } from 'vitest'
import { featureOn } from '../src/features.ts'

const info = (features?: Readonly<Record<string, boolean>>) => ({
  name: 'dovecote' as const,
  version: '1',
  contactMode: 'open' as const,
  signInWith: 'Google',
  ...(features !== undefined && { features }),
})

describe('featureOn', () => {
  it('takes each feature’s default when the server says nothing, and follows the server when it does', () => {
    expect(featureOn('teaching', null)).toBe(true)
    expect(featureOn('teaching', info())).toBe(true)
    expect(featureOn('teaching', info({ teaching: false }))).toBe(false)
    expect(featureOn('channels', info({ teaching: false }))).toBe(true)
  })
})
