import { LOCALES } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { inspectorWords } from '../../src/inspector/words.ts'

describe('inspectorWords', () => {
  it.each(LOCALES)('says how many requests run in %s', (locale) => {
    const words = inspectorWords(locale)
    expect(words.summary({ count: 2 })).toContain('2')
    expect(words.againFor({ list: 'debates' })).toContain('debates')
  })
})
