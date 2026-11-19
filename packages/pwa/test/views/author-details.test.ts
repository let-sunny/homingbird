import { lifetime } from '@homingbird/ui'
import { fire, getByRole, installFakeDom, isPopoverOpen, uninstallFakeDom } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { noteItemModel } from '../../src/models/note-item.ts'
import { HOVER_CLOSE_MS, HOVER_OPEN_MS, authorButton } from '../../src/views/author-details.ts'
import { testContext } from '../support/context.ts'
import { mount, settle, usingFakeDom } from '../support/dom.ts'
import { note } from '../support/fixtures.ts'
import { threadInput } from '../support/thread.ts'

usingFakeDom()

const author = () =>
  noteItemModel(threadInput(), {
    type: 'note',
    key: 'n1',
    note: note('n1', { origin: 'agent' }),
    leadsRun: true,
    next: null,
  }).author!

describe('authorButton', () => {
  it('opens the details on a pause of the mouse, closes them when it leaves, and keeps a click open', async () => {
    const { context, clock } = testContext()
    const shown = mount(authorButton(context, lifetime(), author()))
    const trigger = shown.querySelector('button')!
    const details = shown.querySelector<HTMLElement>('.author-details')!
    fire.event(trigger, 'pointerenter', { pointerType: 'touch' })
    fire.event(trigger, 'pointerenter')
    await clock.advance(HOVER_OPEN_MS)
    expect(isPopoverOpen(details as never)).toBe(true)
    trigger.click()
    expect(isPopoverOpen(details as never)).toBe(true)
    fire.event(details, 'pointerleave', { pointerType: 'pen' })
    fire.event(details, 'pointerleave')
    await clock.advance(HOVER_CLOSE_MS)
    expect(isPopoverOpen(details as never)).toBe(true)
    details.hidePopover()
    fire.event(trigger, 'pointerenter')
    await clock.advance(HOVER_OPEN_MS)
    fire.event(trigger, 'pointerleave')
    await clock.advance(HOVER_CLOSE_MS)
    expect(isPopoverOpen(details as never)).toBe(false)
  })

  it('closes a manual popover with Escape or a press elsewhere, where hint popovers are missing', () => {
    const { context, page } = testContext()
    page.state.hint = false
    const shown = mount(authorButton(context, lifetime(), author()))
    const trigger = shown.querySelector('button')!
    const details = shown.querySelector<HTMLElement>('.author-details')!
    trigger.click()
    expect(isPopoverOpen(details as never)).toBe(true)
    fire.key(document.body, 'a')
    fire.event(details, 'pointerdown')
    expect(isPopoverOpen(details as never)).toBe(true)
    fire.event(document.body, 'pointerdown')
    expect(isPopoverOpen(details as never)).toBe(false)
    trigger.click()
    details.querySelector<HTMLElement>('p')!.setAttribute('tabindex', '0')
    details.querySelector<HTMLElement>('p')!.focus()
    fire.key(document.body, 'Escape')
    expect(isPopoverOpen(details as never)).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps the details open and the focus where they were when the note is drawn again', async () => {
    const { context } = testContext()
    const first = mount(authorButton(context, lifetime(), author()))
    first.querySelector('button')!.click()
    first.querySelector('button')!.focus()
    const second = authorButton(context, lifetime(), author())
    first.replaceWith(second)
    await settle()
    expect(isPopoverOpen(second.querySelector('.author-details') as never)).toBe(true)
    expect(document.activeElement).toBe(second.querySelector('button'))
    const detached = authorButton(context, lifetime(), author())
    await settle()
    expect(detached.isConnected).toBe(false)
  })

  it('works without popovers: a click toggles the details, Escape or leaving closes them', async () => {
    uninstallFakeDom()
    installFakeDom({ popovers: false })
    const { context } = testContext()
    const first = mount(authorButton(context, lifetime(), author()))
    const trigger = first.querySelector('button')!
    const details = first.querySelector<HTMLElement>('.author-details')!
    expect(details.hidden).toBe(true)
    trigger.click()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fire.key(trigger, 'a')
    fire.key(trigger, 'Escape')
    expect(details.hidden).toBe(true)
    fire.key(trigger, 'Escape')
    trigger.click()
    fire.event(details, 'focusout', { relatedTarget: trigger as never })
    expect(details.hidden).toBe(false)
    fire.event(details, 'focusout', { relatedTarget: null })
    expect(details.hidden).toBe(true)
    trigger.click()
    const second = authorButton(context, lifetime(), author())
    first.replaceWith(second)
    await settle()
    expect(second.querySelector<HTMLElement>('.author-details')!.hidden).toBe(false)
    expect(getByRole(second, 'button')).toBeTruthy()
  })
})
