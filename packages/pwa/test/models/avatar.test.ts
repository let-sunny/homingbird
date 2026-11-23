import { isPipLook } from '@homingbird/protocol'
import { presetById } from '@homingbird/sprites'
import { afterEach, describe, expect, it } from 'vitest'
import { characterOf } from '../../src/characters.ts'
import { avatarOf, characterName, groupAvatarOf, memberAvatarOf } from '../../src/models/avatar.ts'
import { strings, useLanguage } from '../../src/strings.ts'
import { ANA, BEN, CY, member } from '../support/fixtures.ts'

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

  it('falls back to the given name for a built-in the language does not name', () => {
    const names = strings.character.names as Record<string, string | undefined>
    const owl = names.owl
    try {
      names.owl = undefined
      expect(characterName(presetById('owl')!)).toBe(presetById('owl')!.name)
    } finally {
      names.owl = owl
    }
  })
})

describe('avatars', () => {
  const owl = presetById('owl')!

  it('fills in a still, idle character at twice its size', () => {
    expect(avatarOf(owl)).toEqual({
      spec: owl,
      scale: 2,
      state: 'idle',
      motion: 'still',
      settle: 'idle',
      label: null,
    })
  })

  it('names the person and their character, unless the avatar stands beside their name', () => {
    const ana = member(ANA, 'Ana', { character: owl })
    expect(memberAvatarOf(ana, true).label).toBe(
      strings.character.avatarLabel({ person: 'Ana', character: 'Owl' }),
    )
    expect(memberAvatarOf(ana, true, { labelled: false }).label).toBeNull()
    expect(memberAvatarOf(ana, false).spec).toBe(characterOf(ana, false))
    expect(isPipLook(memberAvatarOf(ana, false).spec)).toBe(false)
    expect(memberAvatarOf(undefined, true).label).toBe(
      strings.character.avatarLabel({
        person: strings.formerMember,
        character: characterName(characterOf(undefined, true)),
      }),
    )
  })

  it('shows the first two people of a group side by side, small and unlabelled, and how many more', () => {
    const group = groupAvatarOf([member(ANA, 'Ana'), member(BEN, 'Ben'), member(CY, 'Cy')], true)
    expect(group.faces).toHaveLength(2)
    expect(group.faces.every((face) => face.scale === 1 && face.label === null)).toBe(true)
    expect(group.more).toBe(strings.moreFaces({ count: 1 }))
    expect(groupAvatarOf([member(ANA, 'Ana'), member(BEN, 'Ben')], true).more).toBeNull()
  })
})
