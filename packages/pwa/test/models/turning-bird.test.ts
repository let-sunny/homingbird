import { PRESETS } from '@homingbird/sprites'
import { describe, expect, it } from 'vitest'
import { avatarOf } from '../../src/models/avatar.ts'
import { turningBirdOf, turningPip } from '../../src/models/turning-bird.ts'

describe('turning birds', () => {
  it('shows Pip as decoration, drawn from the brand file', () => {
    expect(turningPip(2)).toEqual({ character: null, scale: 2, label: null })
  })

  it('turns the character an avatar shows, named in the same words', () => {
    const fox = PRESETS.find((preset) => preset.id === 'fox')!
    expect(turningBirdOf(avatarOf(fox, { label: 'Ana as Fox' }), 3)).toEqual({
      character: fox,
      scale: 3,
      label: 'Ana as Fox',
    })
  })
})
