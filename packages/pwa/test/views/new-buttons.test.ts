import { h } from '@homingbird/ui'
import { getByRole } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { newChannelButton, newMessageLink } from '../../src/views/new-buttons.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { everything, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const drawn = (info = everything()) => {
  const test = testContext()
  test.context.state.serverInfo.set(info)
  mount(dialogHost())
  const shown = mount(h('div', {}, newMessageLink(test.context), newChannelButton(test.context)))
  return { ...test, shown }
}

describe('newMessageLink', () => {
  it('links to the new-message screen and describes itself with its hint', () => {
    const { shown } = drawn()
    const link = getByRole(shown, 'link', { name: strings.newMessageButton })
    expect(link.getAttribute('href')).toBe('#/new')
    const hint = shown.querySelectorAll('.hint-tip')[0]!
    expect([link.getAttribute('aria-describedby'), hint.textContent]).toEqual([
      hint.id,
      strings.hints.newMessage,
    ])
  })
})

describe('newChannelButton', () => {
  it('opens the form the Channels page opens to create a channel', () => {
    const { shown } = drawn()
    const button = getByRole(shown, 'button', { name: strings.newChannel })
    const hint = shown.querySelectorAll('.hint-tip')[1]!
    expect([button.getAttribute('aria-describedby'), hint.textContent]).toEqual([
      hint.id,
      strings.hints.newChannel,
    ])
    button.click()
    expect(document.getElementById('dialog')!.querySelector('form.create-channel')).not.toBeNull()
  })

  it('is left out where channels are off', () => {
    const { shown } = drawn(serverInfo({ channels: false }))
    expect(shown.querySelector('.new-channel-link')).toBeNull()
    expect(shown.querySelector('.new-message-link')).not.toBeNull()
  })
})
