import { describe, expect, it } from 'vitest'
import { featureOn } from '../src/features.ts'

const info = (features?: Readonly<Record<string, boolean>>) => ({
  name: 'dovecote' as const,
  version: '0.1.3',
  contactMode: 'open' as const,
  signInWith: 'Google',
  protocolVersion: 1,
  ...(features !== undefined && { features }),
})

describe('featureOn', () => {
  it('takes each feature’s default before the server answers, and follows the server once it does', () => {
    expect(featureOn('teaching', null)).toBe(true)
    expect(featureOn('teaching', info({ teaching: true }))).toBe(true)
    expect(featureOn('teaching', info({ teaching: false }))).toBe(false)
  })

  it('leaves out a feature the server does not list, and every feature of a server that lists none', () => {
    expect(featureOn('debateRooms', info({ teaching: true }))).toBe(false)
    expect(featureOn('teaching', info())).toBe(false)
    expect(featureOn('channels', info())).toBe(false)
  })
})
