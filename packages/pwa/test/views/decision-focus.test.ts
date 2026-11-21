import { h } from '@homingbird/ui'
import { describe, expect, it } from 'vitest'
import { cardOf, focusAfterDecision } from '../../src/views/decision-focus.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const card = (id: string) =>
  h('li', { data: { decides: id, decisionUnit: '' }, tabindex: '-1' }, h('button', { type: 'button' }, id))

const pending = (...ids: string[]) =>
  h(
    'li',
    { data: { decisionUnit: '' } },
    ids.map((id) => h('article', { data: { decides: id }, tabindex: '-1' })),
  )

describe('the focus after a decision', () => {
  it('moves to the next card waiting in the same place, or the one before when it was the last', () => {
    const { context, page } = testContext()
    const stage = mount(
      h('main', { class: 'stage' }, h('ul', {}, card('a1'), pending('d1', 'd2'), card('a3'))),
    )
    focusAfterDecision(context, stage.querySelector('[data-decides="a1"]'), 'a1' as never)
    page.runFrames()
    expect(document.activeElement).toBe(stage.querySelector('[data-decides="d1"]'))
    focusAfterDecision(context, stage.querySelector('[data-decides="a3"]'), 'a3' as never)
    page.runFrames()
    expect(document.activeElement).toBe(stage.querySelector('[data-decides="d1"]'))
  })

  it('finds the next card again after it was drawn anew, and keeps to the panel it was decided in', () => {
    const { context, page } = testContext()
    const stage = mount(h('main', { class: 'stage' }, h('ul', {}, card('a1'), card('a2'))))
    const panel = mount(h('div', { class: 'activity-panel' }, h('ul', {}, card('a1'), card('a2'))))
    focusAfterDecision(context, panel.querySelector('[data-decides="a1"] button'), 'a1' as never)
    stage.querySelector('ul')!.replaceChildren(card('a2'))
    page.runFrames()
    expect(panel.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.getAttribute('data-decides')).toBe('a2')
  })

  it('goes to the composer when no card is left, else to the Undo of the line in the card’s place', () => {
    const { context, page } = testContext()
    const composer = h('div', { class: 'composer' }, h('textarea', {}))
    const stage = mount(h('main', { class: 'stage' }, h('ul', {}, card('a1')), composer))
    focusAfterDecision(context, stage.querySelector('[data-decides="a1"]'), 'a1' as never)
    page.runFrames()
    expect(document.activeElement).toBe(composer.querySelector('textarea'))
    const line = h(
      'li',
      { data: { heldUnit: 'b1' } },
      h('button', { type: 'button', class: 'held-undo' }, 'Undo'),
    )
    const panel = mount(h('div', { class: 'activity-panel' }, h('ul', {}, card('b1'))))
    focusAfterDecision(context, panel.querySelector('[data-decides="b1"]'), 'b1' as never)
    panel.querySelector('ul')!.replaceChildren(line)
    page.runFrames()
    expect(document.activeElement).toBe(line.querySelector('button'))
    focusAfterDecision(context, null, 'gone' as never)
    page.runFrames()
    expect(document.activeElement).toBe(composer.querySelector('textarea'))
  })

  it('goes to the composer when the next place holds no card to decide', () => {
    const { context, page } = testContext()
    const composer = h('div', { class: 'composer' }, h('textarea', {}))
    const empty = h('li', { data: { decisionUnit: '' } })
    const stage = mount(h('main', { class: 'stage' }, h('ul', {}, card('a1'), empty), composer))
    focusAfterDecision(context, stage.querySelector('[data-decides="a1"]'), 'a1' as never)
    page.runFrames()
    expect(document.activeElement).toBe(composer.querySelector('textarea'))
  })

  it('finds the card a dialog decides by the focus, else the first on the page', () => {
    const { context } = testContext()
    const stage = mount(h('main', { class: 'stage' }, card('a1')))
    const panel = mount(h('div', { class: 'activity-panel' }, card('a1')))
    expect(cardOf(context, 'a1' as never)).toBe(stage.querySelector('[data-decides]'))
    ;(panel.querySelector('button') as HTMLElement).focus()
    expect(cardOf(context, 'a1' as never)).toBe(panel.querySelector('[data-decides]'))
  })
})
