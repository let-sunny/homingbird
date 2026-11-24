import { describe, expect, it } from 'vitest'
import { en } from '../../../src/languages/inspector/en.ts'

describe('the inspector in English', () => {
  it('never raises its voice with an exclamation mark', () => {
    expect(JSON.stringify(en)).not.toContain('!')
  })
})
