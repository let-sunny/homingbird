import { PRESETS } from '@homingbird/sprites'
import { describe, expect, it } from 'vitest'
import { avatarOf } from '../../src/models/avatar.ts'
import { renderTurningBird } from '../../src/views/turning-bird.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('renderTurningBird', () => {
  const owl = PRESETS.find((preset) => preset.id === 'owl')!

  it("hands the character's sheet, drawn in the browser, to the stylesheet, and names it", () => {
    const { context } = testContext()
    const shown = renderTurningBird(context, avatarOf(owl, { label: 'Ana as Owl' }))
    const turning = shown.querySelector('.turning-bird') as HTMLElement
    expect(turning.getAttribute('role')).toBe('img')
    expect(turning.getAttribute('aria-label')).toBe('Ana as Owl')
    expect(turning.dataset.character).toBe('owl')
    expect(turning.style.getPropertyValue('--turn-sheet')).toBe('url("data:image/png;fake,720x51")')
  })

  it("puts the character's flat sprite beside the turning bird for reduced motion", () => {
    const { context } = testContext()
    const shown = renderTurningBird(context, avatarOf(owl, { label: 'Ana as Owl' }))
    expect(shown.className).toBe('character-turn')
    const still = shown.querySelector('canvas.turn-still') as HTMLElement
    expect(still.className).toContain('character-x4')
    expect(still.getAttribute('aria-label')).toBe('Ana as Owl')
    expect(still.dataset.character).toBe('owl')
  })

  it('hides an unnamed bird from assistive technology', () => {
    const { context } = testContext()
    const turning = renderTurningBird(context, avatarOf(owl)).querySelector('.turning-bird') as HTMLElement
    expect(turning.getAttribute('aria-hidden')).toBe('true')
    expect(turning.getAttribute('role')).toBe('presentation')
  })
})
