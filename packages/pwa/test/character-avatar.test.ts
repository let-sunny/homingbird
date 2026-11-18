import { presetById } from '@homingbird/sprites'
import { afterEach, describe, expect, it } from 'vitest'
import { useLanguage } from '../src/strings.ts'
import { characterName } from '../src/views/character-avatar.ts'

afterEach(() => useLanguage('en'))

describe('characterName', () => {
  it('names a built-in character in the reader’s language', () => {
    expect(characterName(presetById('owl')!)).toBe('Owl')
    useLanguage('ko')
    expect(characterName(presetById('owl')!)).toBe('부엉이')
    expect(characterName(presetById('pigeon')!)).toBe('비둘기')
  })

  it('names a made character by the name its maker gave it, in every language', () => {
    const made = { ...presetById('owl')!, id: 'my-owl', name: 'Hoot' }
    expect(characterName(made)).toBe('Hoot')
    useLanguage('ko')
    expect(characterName(made)).toBe('Hoot')
  })
})
