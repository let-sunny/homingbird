import { Task as T } from '@homingbird/kernel'
import { lifetime } from '@homingbird/ui'
import { getByRole, textOf } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { heldWordsFor } from '../../src/held-decisions.ts'
import type { HeldDecision } from '../../src/state.ts'
import { strings } from '../../src/strings.ts'
import { heldToast, heldToastInPanel, placeHeldToast, renderHeldLine } from '../../src/views/held-toast.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'
import { ROOM } from '../support/fixtures.ts'

usingFakeDom()

const decision = (phase: HeldDecision['phase'], noteId = 'n1'): HeldDecision => ({
  noteId: noteId as never,
  conversationId: ROOM,
  kind: 'send',
  review: false,
  settles: 1,
  words: heldWordsFor('Ben').send,
  run: T.unit,
  phase,
})

const start = () => {
  const test = testContext()
  const life = lifetime()
  const toast = mount(heldToast(test.context, life))
  return { ...test, toast, life }
}

describe('the held toast', () => {
  it('says a send is pending with Undo and Send now, shown in the top layer, then that it was sent', async () => {
    const { context, toast, called, clock } = start()
    expect(toast.matches(':popover-open')).toBe(false)
    context.state.held.set([decision('waiting')])
    expect(toast.matches(':popover-open')).toBe(true)
    expect(textOf(toast)).toContain(strings.heldSendingIn({ names: 'Ben', seconds: 5 }))
    getByRole(toast, 'button', { name: strings.undo }).click()
    expect(called('undoHeld')).toHaveLength(1)
    getByRole(toast, 'button', { name: strings.heldSendNow }).click()
    expect(called('commitHeld')[0]!.then!.attempt).toBe('draft')
    context.state.held.set([decision('committing')])
    expect(toast.querySelectorAll('button')).toHaveLength(0)
    context.state.held.set([decision('done')])
    expect(textOf(toast)).toContain(strings.heldSent({ names: 'Ben' }))
    getByRole(toast, 'button', { name: strings.close }).click()
    expect(called('forgetSettled')).toHaveLength(1)
    await clock.advance(3000)
    expect(called('forgetSettled')).toHaveLength(2)
    context.state.held.set([])
    expect(toast.matches(':popover-open')).toBe(false)
  })

  it('carries a waiting decision out when its time is up, once, or when the page goes', async () => {
    const { context, called, clock, page } = start()
    const waiting = decision('waiting')
    context.state.held.set([waiting])
    await clock.advance(4999)
    context.state.held.set([decision('done', 'n0'), waiting])
    expect(called('commitHeld')).toHaveLength(0)
    await clock.advance(1)
    expect(called('commitHeld')).toHaveLength(1)
    context.state.held.set([])
    await clock.advance(5000)
    expect(called('commitHeld')).toHaveLength(1)
    page.emit('pagehide')
    page.state.visible = false
    page.emit('visibilitychange')
    page.state.visible = true
    page.emit('visibilitychange')
    expect(called('commitHeld')).toHaveLength(3)
  })

  it('moves into the activity panel while it is open, so Undo there keeps the panel open, unless the panel shows its line', () => {
    const { context, toast, life, page } = start()
    context.state.held.set([decision('waiting')])
    placeHeldToast(context, true)
    expect(toast.matches(':popover-open')).toBe(false)
    const inPanel = mount(heldToastInPanel(context, life))
    expect(textOf(inPanel)).toContain(strings.heldSendingIn({ names: 'Ben', seconds: 5 }))
    page.runFrames()
    expect(inPanel.hidden).toBe(false)
    const line = mount(document.createElement('li'))
    line.setAttribute('data-held-unit', 'n1')
    context.state.held.set([decision('committing')])
    page.runFrames()
    expect(inPanel.hidden).toBe(true)
    line.remove()
    context.state.held.set([decision('waiting')])
    placeHeldToast(context, false)
    expect(toast.matches(':popover-open')).toBe(true)
    toast.remove()
    placeHeldToast(context, true)
  })

  it('shows where the Popover API is missing as an ordinary toast', () => {
    const { context, toast } = start()
    Object.defineProperty(toast, 'showPopover', { value: undefined })
    context.state.held.set([decision('waiting')])
    expect(textOf(toast)).toContain(strings.heldSendingIn({ names: 'Ben', seconds: 5 }))
  })

  it('shows a decided card’s line in its place, and gives the focus back to the card on Undo', () => {
    const { context, called, page } = start()
    const card = mount(document.createElement('article'))
    card.setAttribute('data-decides', 'n1')
    card.setAttribute('tabindex', '-1')
    const line = mount(
      renderHeldLine(context, {
        noteId: 'n1' as never,
        className: 'held-line is-send',
        text: 'Sending…',
        countdown: null,
        undo: strings.undo,
      }),
    )
    expect(line.getAttribute('data-held-unit')).toBe('n1')
    getByRole(line, 'button', { name: strings.undo }).click()
    expect(called('undoHeld')).toHaveLength(1)
    page.runFrames()
    expect(document.activeElement).toBe(card)
    const done = renderHeldLine(context, {
      noteId: 'n1' as never,
      className: 'held-line',
      text: 'Sent',
      countdown: null,
      undo: null,
    })
    expect(done.querySelector('button')).toBeNull()
  })

  it('counts the seconds down in the toast and on the card’s line, and starts again for the next decision', async () => {
    const { context, toast, clock } = start()
    const waiting = decision('waiting')
    context.state.held.set([waiting])
    const line = mount(
      renderHeldLine(context, {
        noteId: 'n1' as never,
        className: 'held-line is-send',
        text: '',
        countdown: waiting.words.waiting,
        undo: strings.undo,
      }),
    )
    expect(textOf(line)).toContain(strings.heldSendingIn({ names: 'Ben', seconds: 5 }))
    await clock.advance(1000)
    expect(textOf(line)).toContain(strings.heldSendingIn({ names: 'Ben', seconds: 4 }))
    await clock.advance(3000)
    expect(textOf(line)).toContain(strings.heldSendingIn({ names: 'Ben', seconds: 1 }))
    await clock.advance(500)
    expect(context.state.heldSecondsLeft.get()).toBe(1)
    line.remove()
    context.state.held.set([decision('waiting', 'n2')])
    expect(context.state.heldSecondsLeft.get()).toBe(5)
    expect(textOf(line)).toContain(strings.heldSendingIn({ names: 'Ben', seconds: 1 }))
    expect(textOf(toast)).toContain(strings.heldSendingIn({ names: 'Ben', seconds: 5 }))
  })

  it('leaves the toast closed while the decision’s own line says it on the page', () => {
    const { context, toast, page } = start()
    const line = mount(document.createElement('li'))
    line.setAttribute('data-held-unit', 'n1')
    context.state.held.set([decision('waiting')])
    page.runFrames()
    expect(toast.matches(':popover-open')).toBe(false)
    line.remove()
    context.state.held.set([decision('committing')])
    page.runFrames()
    expect(toast.matches(':popover-open')).toBe(true)
  })
})
