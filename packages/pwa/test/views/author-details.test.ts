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
  it('opens the details on a pause of the mouse, closes them when it leaves, and closes them on a click', async () => {
    const { context, clock } = testContext()
    const shown = mount(authorButton(context, lifetime(), author()))
    const trigger = shown.querySelector('button')!
    const details = shown.querySelector<HTMLElement>('.author-details')!
    expect(trigger.getAttribute('popovertarget')).toBe('profile-card')
    expect(trigger.dataset.profileNote).toBe(details.id)
    expect(trigger.getAttribute('aria-describedby')).toBe(details.id)
    fire.event(trigger, 'pointerenter', { pointerType: 'touch' })
    fire.event(trigger, 'pointerenter')
    await clock.advance(HOVER_OPEN_MS)
    expect(isPopoverOpen(details as never)).toBe(true)
    fire.event(details, 'pointerleave', { pointerType: 'pen' })
    fire.event(details, 'pointerleave')
    fire.event(details, 'pointerenter')
    await clock.advance(HOVER_CLOSE_MS)
    expect(isPopoverOpen(details as never)).toBe(true)
    trigger.click()
    expect(isPopoverOpen(details as never)).toBe(false)
    fire.event(trigger, 'pointerenter')
    await clock.advance(HOVER_OPEN_MS)
    expect(isPopoverOpen(details as never)).toBe(false)
    trigger.click()
    fire.event(trigger, 'pointerenter')
    await clock.advance(HOVER_OPEN_MS)
    fire.event(trigger, 'pointerleave')
    await clock.advance(HOVER_CLOSE_MS)
    expect(isPopoverOpen(details as never)).toBe(false)
  })

  it('closes a manual popover with Escape or a press elsewhere, where hint popovers are missing', async () => {
    const { context, page, clock } = testContext()
    page.state.hint = false
    const shown = mount(authorButton(context, lifetime(), author()))
    const trigger = shown.querySelector('button')!
    const details = shown.querySelector<HTMLElement>('.author-details')!
    const hover = async (): Promise<void> => {
      fire.event(trigger, 'pointerenter')
      await clock.advance(HOVER_OPEN_MS)
    }
    await hover()
    expect(isPopoverOpen(details as never)).toBe(true)
    fire.key(document.body, 'a')
    fire.event(details, 'pointerdown')
    expect(isPopoverOpen(details as never)).toBe(true)
    fire.event(document.body, 'pointerdown')
    expect(isPopoverOpen(details as never)).toBe(false)
    await hover()
    fire.key(document.body, 'Escape')
    expect(isPopoverOpen(details as never)).toBe(false)
    await hover()
    details.querySelector<HTMLElement>('p')!.setAttribute('tabindex', '0')
    details.querySelector<HTMLElement>('p')!.focus()
    fire.key(document.body, 'Escape')
    expect(isPopoverOpen(details as never)).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps the details open, the focus and the profile card beside it when the note is drawn again', async () => {
    const { context, clock } = testContext()
    const first = mount(authorButton(context, lifetime(), author()))
    const firstTrigger = first.querySelector('button')!
    fire.event(firstTrigger, 'pointerenter')
    await clock.advance(HOVER_OPEN_MS)
    firstTrigger.focus()
    firstTrigger.style.setProperty('anchor-name', '--author-n1, --profile-card')
    const second = authorButton(context, lifetime(), author())
    first.replaceWith(second)
    await settle()
    expect(isPopoverOpen(second.querySelector('.author-details') as never)).toBe(true)
    expect(document.activeElement).toBe(second.querySelector('button'))
    expect(second.querySelector('button')!.style.getPropertyValue('anchor-name')).toBe(
      '--author-n1, --profile-card',
    )
    const third = authorButton(context, lifetime(), author())
    second.replaceWith(third)
    expect(third.querySelector('button')!.style.getPropertyValue('anchor-name')).toBe(
      '--author-n1, --profile-card',
    )
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
