import { h } from '@homingbird/ui'
import { fakeEvent, fire, installFakeDom, isPopoverOpen, uninstallFakeDom } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { HINTS_RETIRE_AFTER_MS, HINT_DELAY_MS } from '../../src/hints.ts'
import { strings } from '../../src/strings.ts'
import { hinted } from '../../src/views/hint.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { me } from '../support/fixtures.ts'

usingFakeDom()

const KEY = 'homingbird.hints.anyone'

const shown = (context: ReturnType<typeof testContext>['context'], properties = {}) => {
  const [target, hint] = hinted(
    context,
    'approveAndSend',
    'Click to send this exactly as shown.',
    h('button', { type: 'button', ...properties }, 'Approve and send'),
  )
  mount(h('div', {}, target, hint))
  return { target, hint }
}

const isOpen = (hint: HTMLElement): boolean => isPopoverOpen(hint as never)

describe('hinted', () => {
  it('describes the control with the hint, beside what already describes it', () => {
    const { context } = testContext()
    const { target, hint } = shown(context, { 'aria-describedby': 'other' })
    expect(target.getAttribute('aria-describedby')).toBe(`other ${hint.id}`)
    expect(hint.getAttribute('role')).toBe('tooltip')
    expect(hint.getAttribute('popover')).toBe('hint')
    expect(hint.textContent).toBe('Click to send this exactly as shown.')
    expect(isOpen(hint)).toBe(false)
  })

  it('shows the hint once the mouse rests on the control, and hides it when the mouse leaves', async () => {
    const { context, clock } = testContext()
    const { target, hint } = shown(context)
    fire.event(target, 'pointerenter', { pointerType: 'touch' })
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(hint)).toBe(false)
    fire.event(target, 'pointerenter')
    await clock.advance(HINT_DELAY_MS - 1)
    expect(isOpen(hint)).toBe(false)
    await clock.advance(1)
    expect(isOpen(hint)).toBe(true)
    fire.event(target, 'pointerenter')
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(hint)).toBe(true)
    fire.event(target, 'pointerleave')
    expect(isOpen(hint)).toBe(false)
  })

  it('shows the hint on keyboard focus, closes it on Escape, and not on focus a press brought', async () => {
    const { context, clock } = testContext()
    const { target, hint } = shown(context)
    target.focus()
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(hint)).toBe(true)
    fire.key(document.body, 'a')
    expect(isOpen(hint)).toBe(true)
    fire.key(document.body, 'Escape')
    expect(isOpen(hint)).toBe(false)
    fire.key(document.body, 'Escape')
    target.blur()
    fire.event(target, 'pointerdown')
    target.focus()
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(hint)).toBe(false)
  })

  it('shows nothing when focus returns to a control a press used, until the keyboard takes over', async () => {
    const { context, clock } = testContext()
    const { target, hint } = shown(context)
    target.focus()
    fire.event(target, 'pointerdown')
    target.click()
    target.blur()
    fire.key(document.body, 'Escape')
    target.focus()
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(hint)).toBe(false)
    target.blur()
    fire.key(document.body, 'Tab')
    target.focus()
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(hint)).toBe(true)
  })

  it('lets the mouse moving on a control a press used bring its hint back', async () => {
    const { context, clock } = testContext()
    const { target, hint } = shown(context)
    target.click()
    fire.event(target, 'pointermove')
    target.focus()
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(hint)).toBe(false)
    target.blur()
    const moved = fakeEvent('pointermove')
    Object.assign(moved, { movementX: 3 })
    target.dispatchEvent(moved as never)
    target.focus()
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(hint)).toBe(true)
  })

  it('keeps the browser from showing an invoker’s hint on the focus that returns after a press', () => {
    const { context, page } = testContext()
    page.state.interest = true
    const { target, hint } = shown(context)
    expect(fire.event(hint, 'beforetoggle', { newState: 'open' })).toBe(true)
    target.click()
    expect(fire.event(hint, 'beforetoggle', { newState: 'open' })).toBe(false)
    expect(fire.event(hint, 'beforetoggle', { newState: 'closed' })).toBe(true)
    fire.key(document.body, 'Tab')
    expect(fire.event(hint, 'beforetoggle', { newState: 'open' })).toBe(true)
  })

  it('keeps showing the hint on hover after the control is used', async () => {
    const { context, clock, page } = testContext()
    const first = shown(context)
    first.target.click()
    first.target.click()
    expect(JSON.parse(page.local.get(KEY)!).used).toEqual([])
    const again = shown(context)
    expect(again.hint.hidden).toBe(false)
    expect(again.hint.getAttribute('popover')).toBe('hint')
    fire.event(again.target, 'pointerenter')
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(again.hint)).toBe(true)
    fire.event(again.target, 'click')
    expect(isOpen(again.hint)).toBe(false)
  })

  it('keeps showing the hint on hover after the person’s first two weeks, and on focus too', async () => {
    const { context, clock } = testContext()
    shown(context)
    await clock.advance(HINTS_RETIRE_AFTER_MS * 2)
    const late = shown(context)
    expect(late.hint.hidden).toBe(false)
    fire.event(late.target, 'pointerenter')
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(late.hint)).toBe(true)
    fire.event(late.target, 'pointerleave')
    late.target.focus()
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(late.hint)).toBe(true)
    expect(late.target.getAttribute('aria-describedby')).toBe(late.hint.id)
  })

  it('shows a touch screen no inline hint after two weeks or after the control was used', async () => {
    const { context, clock, page } = testContext()
    page.state.coarsePointer = true
    const used = shown(context)
    used.target.click()
    page.runFrames()
    expect(shown(context).hint.hidden).toBe(true)
    page.local.clear()
    shown(context)
    page.runFrames()
    await clock.advance(HINTS_RETIRE_AFTER_MS)
    expect(shown(context).hint.hidden).toBe(true)
  })

  it('keeps the hints for the person signed in', () => {
    const { context, page } = testContext()
    context.state.session.set(me())
    shown(context).target.click()
    expect([...page.local.keys()]).toEqual([`homingbird.hints.${me().member.id}`])
  })

  it('leaves showing and hiding to the browser where buttons are interest invokers', async () => {
    const { context, clock, page } = testContext()
    page.state.interest = true
    const { target, hint } = shown(context)
    expect(target.getAttribute('interestfor')).toBe(hint.id)
    expect(hint.classList.contains('is-anchored')).toBe(true)
    fire.event(target, 'pointerenter')
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(hint)).toBe(false)
    const [label, labelHint] = hinted(context, 'draft', 'Your agent wrote this.', h('span', {}, 'Draft'))
    expect(label.hasAttribute('interestfor')).toBe(false)
    expect(labelHint.getAttribute('popover')).toBe('hint')
  })

  it('uses a manual popover where hint popovers are missing, and nothing without popovers', () => {
    const { context, page } = testContext()
    page.state.hint = false
    expect(shown(context).hint.getAttribute('popover')).toBe('manual')
    uninstallFakeDom()
    installFakeDom({ popovers: false })
    const bare = shown(context)
    expect(bare.hint.hidden).toBe(true)
    bare.target.click()
    expect(page.local.get(KEY)).not.toContain('approveAndSend')
  })

  it('puts the hint under its control where the page can measure them', async () => {
    const { context, clock } = testContext()
    const { target, hint } = shown(context)
    const box = (left: number, top: number, width: number, height: number) => () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    })
    Object.assign(target, { getBoundingClientRect: box(40, 100, 120, 30) })
    Object.assign(hint, { getBoundingClientRect: box(0, 0, 200, 24) })
    Object.assign(document.documentElement, { clientWidth: 800, clientHeight: 600 })
    fire.event(target, 'pointerenter')
    await clock.advance(HINT_DELAY_MS)
    expect(hint.style.getPropertyValue('--hb-hint-x')).toBe('40px')
    expect(hint.style.getPropertyValue('--hb-hint-y')).toBe('134px')
  })

  it('shows nothing for a control that left the page while the pointer rested on it', async () => {
    const { context, clock } = testContext()
    const { target, hint } = shown(context)
    fire.event(target, 'pointerenter')
    target.parentElement!.remove()
    await clock.advance(HINT_DELAY_MS)
    expect(isOpen(hint)).toBe(false)
  })

  it('shows a touch screen the hint once, on its own line beside the first control of a kind', () => {
    const { context, page } = testContext()
    page.state.coarsePointer = true
    const first = shown(context)
    const second = shown(context)
    expect(first.hint.classList.contains('hint-inline')).toBe(true)
    expect(first.target.getAttribute('aria-describedby')).toBe(first.hint.querySelector('span')!.id)
    expect(second.hint.hidden).toBe(true)
    page.runFrames()
    const third = shown(context)
    expect(third.hint.classList.contains('hint-inline')).toBe(true)
    third.hint.querySelector<HTMLElement>('.hint-close')!.click()
    expect(third.hint.isConnected).toBe(false)
    expect(third.hint.querySelector('.hint-close')!.getAttribute('aria-label')).toBe(strings.hintClose)
    page.runFrames()
    expect(shown(context).hint.hidden).toBe(true)
  })

  it('takes a touch screen’s inline hint away once its control is used', () => {
    const { context, page } = testContext()
    page.state.coarsePointer = true
    const [target, hint] = hinted(context, 'draft', 'Your agent wrote this.', h('button', {}, 'Draft'))
    mount(h('div', {}, target, hint))
    target.click()
    expect(hint.isConnected).toBe(false)
    expect(JSON.parse(page.local.get(KEY)!).used).toEqual(['draft'])
  })

  it('shows a touch screen the hint of a label that does nothing when pressed on a tap, and hides it on the next', () => {
    const { context, page } = testContext()
    page.state.coarsePointer = true
    const label = (): [HTMLElement, HTMLElement] =>
      hinted(context, 'agentAwake', 'No program is running their agent.', h('span', {}, 'Agent not awake'))
    const [first, inline] = label()
    mount(h('div', {}, first, inline))
    const [target, hint] = label()
    mount(h('div', {}, target, hint))
    expect(hint.hidden).toBe(true)
    target.click()
    expect(hint.hidden).toBe(false)
    expect(hint.textContent).toBe('No program is running their agent.')
    target.click()
    expect(hint.hidden).toBe(true)
    const [control, quiet] = hinted(context, 'agentAwake', 'Hint.', h('button', {}, 'Open'))
    mount(h('div', {}, control, quiet))
    control.click()
    expect(quiet.hidden).toBe(true)
  })
})
