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
  text: strings.mute.unmute,
  label: 'Unmute Ben',
  mark: strings.mute.muted,
  hint: strings.mute.hint,
}

describe('the mute button', () => {
  it('says the action it takes, explains muting, and asks for the opposite of the current state', () => {
    const { context, called } = testContext()
    const host = document.createElement('div')
    host.append(muteButton(context, MUTED))
    const shown = getByRole(host, 'button', { name: 'Unmute Ben' })
    expect(shown.textContent).toBe(strings.mute.unmute)
    expect(shown.getAttribute('title')).toBe(strings.mute.hint)
    expect(shown.dataset.muted).toBe('true')
    shown.click()
    host.replaceChildren(
      muteButton(context, { ...MUTED, muted: false, text: strings.mute.mute, label: 'Mute Ben' }),
    )
    getByRole(host, 'button', { name: 'Mute Ben' }).click()
    expect(called('setMuted').map((call) => call.args)).toEqual([
      [ROOM, false],
      [ROOM, true],
    ])
  })

  it('marks a muted conversation in words', () => {
    expect(mutedMark(strings.mute.muted).textContent).toBe(strings.mute.muted)
  })
})
