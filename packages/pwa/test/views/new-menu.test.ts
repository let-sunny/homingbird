import { h } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/strings.ts'
import { dialogHost } from '../../src/views/dialog.ts'
import { newMenu } from '../../src/views/new-menu.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { everything, me, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

const drawn = (info = everything()) => {
  const test = testContext()
  test.context.state.serverInfo.set(info)
  mount(dialogHost())
  const shown = mount(h('div', {}, newMenu(test.context, me())))
  return { ...test, shown }
}

describe('newMenu', () => {
  it('names its button and opens a menu of what may be started, each with its sentence', () => {
    const { shown } = drawn()
    const trigger = getByRole(shown, 'button', { name: strings.newMenu.label })
    expect(trigger.textContent).toBe(strings.newMenu.trigger)
    const menu = shown.querySelector('#new-menu')!
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.className)).toEqual([
      'menu-item new-menu-message',
      'menu-item new-menu-channel',
      'menu-item new-menu-debate',
    ])
    expect(textOf(menu)).toContain(strings.newMenu.messageHint)
  })

  it('opens the new-message screen, or the form a channel or a debate room starts with', () => {
    const { shown, page } = drawn()
    const menu = shown.querySelector('#new-menu')!
    ;(menu.querySelector('.new-menu-message') as HTMLElement).click()
    expect(page.visited).toEqual(['go #/new'])
    ;(menu.querySelector('.new-menu-channel') as HTMLElement).click()
    const dialog = document.getElementById('dialog')!
    expect(dialog.querySelector('form.create-channel')).not.toBeNull()
    ;(menu.querySelector('.new-menu-debate') as HTMLElement).click()
    expect(dialog.querySelector('form.create-debate')).not.toBeNull()
  })

  it('offers only a message where channels and debate rooms are off', () => {
    const { shown } = drawn(serverInfo())
    expect(shown.querySelector('#new-menu')!.querySelectorAll('[role="menuitem"]')).toHaveLength(1)
  })
})
