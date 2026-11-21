import { presetById } from '@homingbird/sprites'
import { describe, expect, it } from 'vitest'
import { avatarOf } from '../../src/models/avatar.ts'
import { renderAvatar, renderGroupAvatar } from '../../src/views/character-avatar.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const owl = presetById('owl')!

describe('renderAvatar', () => {
  it('draws a character at its scale, named when it stands for a person', () => {
    const { context } = testContext()
    const named = renderAvatar(context, avatarOf(owl, { label: 'Ana as Owl', scale: 3 }))
    expect([
      named.getAttribute('role'),
      named.getAttribute('aria-label'),
      named.getAttribute('width'),
    ]).toEqual(['img', 'Ana as Owl', '48'])
    const plain = renderAvatar(context, avatarOf(owl))
    expect([plain.getAttribute('role'), plain.getAttribute('aria-hidden'), plain.dataset.character]).toEqual([
      'presentation',
      'true',
      'owl',
    ])
  })

  it('plays a state on the clock unless motion is reduced, and settles after playing once', async () => {
    const { context, page, clock } = testContext()
    page.state.reducedMotion = false
    const once = mount(renderAvatar(context, avatarOf(owl, { state: 'new-note', motion: 'once' })))
    const loop = mount(renderAvatar(context, avatarOf(owl, { state: 'drafting', motion: 'loop' })))
    renderAvatar(context, avatarOf(owl, { state: 'drafting', motion: 'loop' }))
    await clock.advance(20_000)
    expect(once.isConnected && loop.isConnected).toBe(true)
    loop.remove()
    await clock.advance(5_000)
    expect(clock.pending()).toBe(0)
  })

  it('draws a group as two small faces side by side, with how many more as a badge', () => {
    const { context } = testContext()
    const faces = [avatarOf(owl, { scale: 1 }), avatarOf(owl, { scale: 1 })]
    const group = renderGroupAvatar(context, { faces, more: '+2' })
    expect(group.querySelectorAll('canvas')).toHaveLength(2)
    expect(group.querySelector('.group-more')?.textContent).toBe('+2')
    expect(renderGroupAvatar(context, { faces, more: null }).querySelector('.group-more')).toBeNull()
  })
})
