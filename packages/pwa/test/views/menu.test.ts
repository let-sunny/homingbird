import { h } from '@homingbird/ui'
import { fire, getByRole, isPopoverOpen } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { LONG_PRESS_MS, actionMenu } from '../../src/views/menu.ts'
import { button } from '../../src/views/parts.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const setup = () => {
  const test = testContext()
  const chosen: string[] = []
  const more = actionMenu(test.context, {
    id: 'row-menu',
    label: 'More for Ana',
    triggerClass: 'row-more',
    menuClass: 'row-menu',
    items: ['Mute', 'Copy', 'Leave'].map((label) =>
      button(label, () => void chosen.push(label), { class: 'menu-item' }),
    ),
  })
  const link = h('a', { href: '#/c/1' }, 'Ana')
  const owner = mount(h('li', { tabindex: '-1' }, link, more.trigger, more.menu))
  more.opensFrom(owner)
  const item = (name: string) => getByRole(more.menu, 'menuitem', { name })
  return { ...test, ...more, owner, link, chosen, item, isOpen: () => isPopoverOpen(more.menu as never) }
}

describe('actionMenu', () => {
  it('opens from its ⋯ button as a named menu and puts the focus on its first item', () => {
    const { trigger, menu, isOpen, item } = setup()
    expect([trigger.getAttribute('aria-haspopup'), trigger.getAttribute('aria-expanded')]).toEqual([
      'menu',
      'false',
    ])
    expect([menu.getAttribute('role'), menu.getAttribute('aria-label')]).toEqual(['menu', 'More for Ana'])
    trigger.click()
    expect(isOpen()).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(item('Mute'))
    expect(menu.classList.contains('is-at-point')).toBe(false)
    expect(menu.style.getPropertyValue('position-anchor')).toBe(trigger.style.getPropertyValue('anchor-name'))
  })

  it('moves between its items with the arrow keys, Home and End, wrapping at either end', () => {
    const { trigger, menu, item } = setup()
    trigger.click()
    const press = (key: string) => fire.key(document.activeElement, key)
    press('ArrowDown')
    expect(document.activeElement).toBe(item('Copy'))
    press('End')
    expect(document.activeElement).toBe(item('Leave'))
    press('ArrowDown')
    expect(document.activeElement).toBe(item('Mute'))
    press('ArrowUp')
    expect(document.activeElement).toBe(item('Leave'))
    press('Home')
    expect(document.activeElement).toBe(item('Mute'))
    expect(fire.key(menu, 'a')).toBe(true)
  })

  it('skips an item that is disabled', () => {
    const { trigger, item } = setup()
    ;(item('Copy') as HTMLButtonElement).disabled = true
    trigger.click()
    fire.key(document.activeElement, 'ArrowDown')
    expect(document.activeElement).toBe(item('Leave'))
    fire.key(document.activeElement, 'ArrowUp')
    expect(document.activeElement).toBe(item('Mute'))
  })

  it('closes on Escape and gives the focus back to the ⋯ button that opened it', () => {
    const { trigger, isOpen } = setup()
    trigger.click()
    expect(fire.key(document.activeElement, 'Escape')).toBe(false)
    expect(isOpen()).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('runs a chosen item, closes, and gives the focus back', () => {
    const { trigger, item, chosen, isOpen } = setup()
    trigger.click()
    item('Copy').click()
    expect(chosen).toEqual(['Copy'])
    expect(isOpen()).toBe(false)
    expect(document.activeElement).toBe(trigger)
    trigger.click()
    ;(item('Leave') as HTMLButtonElement).disabled = true
    fire.event(item('Leave'), 'click')
    expect(isOpen()).toBe(true)
    fire.event(trigger.parentElement, 'click')
    expect(isOpen()).toBe(true)
  })

  it('leaves the focus where an item moved it', () => {
    const { trigger, item, owner } = setup()
    const elsewhere = mount(h('input', {}))
    item('Mute').addEventListener('click', () => elsewhere.focus())
    trigger.click()
    item('Mute').click()
    expect(document.activeElement).toBe(elsewhere)
    expect(owner.contains(document.activeElement)).toBe(false)
  })

  it('closes on Tab, letting the focus move on', () => {
    const { trigger, isOpen } = setup()
    trigger.click()
    expect(fire.key(document.activeElement, 'Tab')).toBe(true)
    expect(isOpen()).toBe(false)
  })

  it('closes on a press outside it, and stays open for a press inside it', () => {
    const { trigger, item, isOpen } = setup()
    trigger.click()
    fire.event(item('Copy'), 'pointerdown')
    fire.event(trigger, 'pointerdown')
    expect(isOpen()).toBe(true)
    fire.event(mount(h('p', {}, 'elsewhere')), 'pointerdown')
    expect(isOpen()).toBe(false)
    fire.event(document.body, 'pointerdown')
    expect(isOpen()).toBe(false)
  })

  it('swallows the tap that closes it on a touch screen, so the tap does not press what is under it', () => {
    const { trigger, isOpen } = setup()
    const under = mount(h('button', { type: 'button' }, 'Mute'))
    let pressed = 0
    under.addEventListener('click', () => void pressed++)
    trigger.click()
    fire.event(under, 'pointerdown', { pointerType: 'touch' })
    expect(isOpen()).toBe(false)
    expect(fire.event(under, 'click')).toBe(false)
    expect(pressed).toBe(0)
    expect(fire.event(under, 'click')).toBe(true)
    expect(pressed).toBe(1)
  })

  it('stops waiting for the swallowed tap once the next press starts', () => {
    const { trigger } = setup()
    const under = mount(h('button', { type: 'button' }, 'Mute'))
    trigger.click()
    fire.event(under, 'pointerdown', { pointerType: 'touch' })
    fire.event(under, 'pointerdown', { pointerType: 'touch' })
    expect(fire.event(under, 'click')).toBe(true)
  })

  it('lets a mouse press outside it close it and still reach what it pressed', () => {
    const { trigger, isOpen } = setup()
    const under = mount(h('button', { type: 'button' }, 'Mute'))
    trigger.click()
    fire.event(under, 'pointerdown', { pointerType: 'mouse' })
    expect(isOpen()).toBe(false)
    expect(fire.event(under, 'click')).toBe(true)
  })

  it('opens where the person right-clicked, instead of the browser’s menu, and returns the focus to the row', () => {
    const { owner, menu, isOpen, item } = setup()
    const label = owner.appendChild(h('span', {}, 'Ana'))
    expect(fire.event(label, 'contextmenu', { clientX: 40, clientY: 60 })).toBe(false)
    expect(isOpen()).toBe(true)
    expect(menu.classList.contains('is-at-point')).toBe(true)
    expect(menu.getAttribute('popover')).toBe('auto')
    expect(document.activeElement).toBe(item('Mute'))
    expect(fire.event(item('Mute'), 'contextmenu')).toBe(false)
    expect(fire.event(owner, 'contextmenu')).toBe(false)
    fire.key(document.activeElement, 'Escape')
    expect(document.activeElement).toBe(owner)
  })

  it('leaves the browser’s own menu to a link that leaves the app and to a field', () => {
    const { owner, isOpen } = setup()
    const outside = owner.appendChild(h('a', { href: 'https://example.com', target: '_blank' }, 'docs'))
    const field = owner.appendChild(h('input', {}))
    expect([fire.event(outside, 'contextmenu'), fire.event(field, 'contextmenu')]).toEqual([true, true])
    expect(isOpen()).toBe(false)
  })

  it('opens from the ContextMenu key and Shift+F10, returning the focus to what had it', () => {
    const { owner, link, isOpen, item } = setup()
    link.focus()
    expect(fire.key(link, 'ContextMenu')).toBe(false)
    expect(isOpen()).toBe(true)
    fire.key(item('Mute'), 'ContextMenu')
    fire.key(document.activeElement, 'Escape')
    expect(document.activeElement).toBe(link)
    owner.focus()
    expect(fire.key(owner, 'F10')).toBe(true)
    expect(isOpen()).toBe(false)
    expect(fire.key(owner, 'F10', { shiftKey: true })).toBe(false)
    expect(isOpen()).toBe(true)
    fire.key(document.activeElement, 'Escape')
    expect(document.activeElement).toBe(owner)
  })

  it('opens on a long press on a touch screen, as a menu the lifting finger does not dismiss', async () => {
    const { owner, link, menu, clock, isOpen } = setup()
    fire.event(link, 'pointerdown', { pointerType: 'touch', clientX: 10, clientY: 20 })
    await clock.advance(LONG_PRESS_MS - 1)
    expect(isOpen()).toBe(false)
    await clock.advance(1)
    expect(isOpen()).toBe(true)
    expect(menu.getAttribute('popover')).toBe('manual')
    expect(menu.classList.contains('is-at-point')).toBe(true)
    fire.event(link, 'pointerup', { pointerType: 'touch' })
    expect(fire.event(link, 'click')).toBe(false)
    expect(isOpen()).toBe(true)
    expect(fire.event(owner, 'click')).toBe(true)
  })

  it('takes a finger that moves or lifts early for a scroll or a tap', async () => {
    const { owner, clock, isOpen } = setup()
    fire.event(owner, 'pointerdown', { pointerType: 'touch', clientX: 10, clientY: 20 })
    fire.event(owner, 'pointermove', { clientX: 14, clientY: 24 })
    fire.event(owner, 'pointermove', { clientX: 10, clientY: 40 })
    fire.event(owner, 'pointermove', { clientX: 10, clientY: 40 })
    await clock.advance(LONG_PRESS_MS)
    expect(isOpen()).toBe(false)
    fire.event(owner, 'pointerdown', { pointerType: 'touch' })
    fire.event(owner, 'pointercancel', { pointerType: 'touch' })
    await clock.advance(LONG_PRESS_MS)
    expect(isOpen()).toBe(false)
    fire.event(owner, 'pointerdown', { pointerType: 'mouse' })
    await clock.advance(LONG_PRESS_MS)
    expect(isOpen()).toBe(false)
    expect(fire.event(owner, 'click')).toBe(true)
  })

  it('opens a touch screen’s own context menu request as a menu the lift does not dismiss', () => {
    const { owner, menu, item } = setup()
    fire.event(owner, 'pointerdown', { pointerType: 'touch' })
    fire.event(owner, 'contextmenu', { clientX: 5, clientY: 5 })
    expect(menu.getAttribute('popover')).toBe('manual')
    fire.key(document.activeElement, 'Escape')
    fire.event(item('Mute'), 'pointerdown', { pointerType: 'touch' })
  })

  it('does not open once the row is gone', async () => {
    const { owner, clock, isOpen } = setup()
    fire.event(owner, 'pointerdown', { pointerType: 'touch' })
    owner.remove()
    await clock.advance(LONG_PRESS_MS)
    expect(isOpen()).toBe(false)
  })

  it('places itself on screen where the browser cannot anchor it', () => {
    const { owner, trigger, menu, page } = setup()
    const root = document.documentElement as unknown as Record<string, unknown>
    Object.assign(root, { clientWidth: 400, clientHeight: 300 })
    const box = (left: number, top: number, width: number, height: number) => () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    })
    Object.assign(menu, { getBoundingClientRect: box(0, 0, 200, 100) })
    Object.assign(trigger, { getBoundingClientRect: box(300, 20, 20, 20) })
    trigger.click()
    expect([menu.style.getPropertyValue('--hb-menu-x'), menu.style.getPropertyValue('--hb-menu-y')]).toEqual([
      '120px',
      '44px',
    ])
    expect(menu.classList.contains('is-at-point')).toBe(true)
    trigger.click()
    fire.event(owner, 'contextmenu', { clientX: 390, clientY: 290 })
    expect([menu.style.getPropertyValue('--hb-menu-x'), menu.style.getPropertyValue('--hb-menu-y')]).toEqual([
      '192px',
      '186px',
    ])
    fire.key(document.activeElement, 'Escape')
    page.state.anchors = true
    trigger.click()
    expect(menu.style.getPropertyValue('--hb-menu-x')).toBe('')
    expect(menu.classList.contains('is-at-point')).toBe(false)
  })
})
