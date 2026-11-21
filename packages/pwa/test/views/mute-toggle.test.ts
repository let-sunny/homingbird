import { getByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { muteButton, mutedMark } from '../../src/views/mute-toggle.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ROOM } from '../support/fixtures.ts'

usingFakeDom()

const MUTED = {
  conversationId: ROOM,
  muted: true,
  label: 'Unmute Ben',
  mark: strings.mute.muted,
  hint: strings.mute.hint,
}

describe('the mute button', () => {
  it('shows a bell named for the action it takes, explains muting, and asks for the opposite of the current state', () => {
    const { context, called } = testContext()
    const host = document.createElement('div')
    host.append(muteButton(context, MUTED))
    const shown = getByRole(host, 'button', { name: 'Unmute Ben' })
    expect(shown.querySelector('svg.bell')).not.toBeNull()
    expect(shown.textContent).toBe('')
    expect(shown.getAttribute('title')).toBe(strings.mute.hint)
    expect(shown.dataset.muted).toBe('true')
    shown.click()
    host.replaceChildren(muteButton(context, { ...MUTED, muted: false, label: 'Mute Ben' }))
    const unmuted = getByRole(host, 'button', { name: 'Mute Ben' })
    expect(unmuted.querySelector('svg.bell.is-ringing')?.querySelectorAll('path')).toHaveLength(3)
    unmuted.click()
    expect(called('setMuted').map((call) => call.args)).toEqual([
      [ROOM, false],
      [ROOM, true],
    ])
  })

  it('marks a muted conversation with a struck bell, in words for screen readers', () => {
    const mark = mutedMark(strings.mute.muted)
    expect(mark.textContent).toBe(strings.mute.muted)
    expect(mark.querySelectorAll('svg.bell path')).toHaveLength(2)
  })
})
