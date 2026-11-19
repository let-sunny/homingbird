import { describe, expect, it } from 'vitest'
import { placeName } from '../../src/models/places.ts'
import { strings } from '../../src/strings.ts'

describe('placeName', () => {
  it('names a channel by its label and the rest as direct messages', () => {
    expect(placeName('billing')).toBe('#billing')
    expect(placeName(null)).toBe(strings.trust.directMessages)
  })
})
