import { describe, expect, it } from 'vitest'
import { logoOf, wordmark } from '../../src/models/branding.ts'

describe('branding', () => {
  it('writes the default name in lower case and an organization’s own as it is', () => {
    expect(wordmark('Homingbird')).toBe('homingbird')
    expect(wordmark('Acme Notes')).toBe('Acme Notes')
  })

  it('uses the organization’s logo, or the default mark', () => {
    expect(logoOf('/logo.png')).toBe('/logo.png')
    expect(logoOf(null)).toBe('/icons/mark.svg')
  })
})
