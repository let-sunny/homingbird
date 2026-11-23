import { PRESETS } from '@homingbird/sprites'
import { describe, expect, it } from 'vitest'
import { turningBirdOf, turningPip } from '../../src/models/turning-bird.ts'
import { strings } from '../../src/strings.ts'
import { loadingWithBird, renderTurningBird, renderTurningPip } from '../../src/views/turning-bird.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('turning bird', () => {
  it('draws Pip from the stylesheet, hidden from assistive technology', () => {
    const pip = renderTurningPip(2)
    expect(pip.className).toBe('turning-bird turn-x2 is-pip')
    expect(pip.getAttribute('aria-hidden')).toBe('true')
    expect(pip.style.getPropertyValue('--turn-sheet')).toBe('')
  })

  it("hands a member's sheet, drawn in the browser, to the stylesheet, and names it", () => {
    const { context } = testContext()
    const owl = PRESETS.find((preset) => preset.id === 'owl')!
    const bird = renderTurningBird(context, turningBirdOf({ spec: owl, label: 'Ana as Owl' }, 3))
    expect(bird.className).toBe('turning-bird turn-x3')
    expect(bird.getAttribute('role')).toBe('img')
    expect(bird.getAttribute('aria-label')).toBe('Ana as Owl')
    expect(bird.dataset.character).toBe('owl')
    expect(bird.style.getPropertyValue('--turn-sheet')).toBe('url("data:image/png;fake,624x39")')
  })

  it('shows a page waiting for its data with a bird above the word', () => {
    const { context } = testContext()
    const waiting = loadingWithBird(context, turningPip(2))
    expect(waiting.getAttribute('role')).toBe('status')
    expect(waiting.querySelector('.turning-bird.is-pip')).not.toBeNull()
    expect(waiting.textContent).toBe(strings.loading)
  })
})
