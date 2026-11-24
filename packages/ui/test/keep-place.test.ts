import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { h, replaceChildren } from '../src/element.ts'
import { holdingStill, keepingPlace } from '../src/keep-place.ts'
import { lifetime, region } from '../src/region.ts'
import { signal } from '../src/signal.ts'
import { installFakeDom, uninstallFakeDom } from '../src/testing/index.ts'

beforeEach(() => installFakeDom())
afterEach(() => uninstallFakeDom())

const scrolledPage = () => {
  const host = h('div')
  const scroller = h('div', { class: 'stage' }, h('p', {}, 'Above'), host)
  document.body.append(scroller)
  Object.assign(scroller, { scrollHeight: 1200, clientHeight: 700, scrollTop: 430 })
  return { host, scroller }
}

const at = (top: number) => () => ({ top, left: 0, right: 0, bottom: top, width: 0, height: 0 })

const switches = (enabled: boolean) => [
  h('button', { class: 'todo-switch', 'aria-checked': String(enabled) }, 'one'),
  h('button', { class: 'todo-switch', 'aria-checked': 'true' }, 'two'),
]

describe('keepingPlace', () => {
  it('puts every scroll container around the host back where it was after the focused control is redrawn', () => {
    const { host, scroller } = scrolledPage()
    replaceChildren(host, switches(true))
    ;(host.firstChild as HTMLElement).focus()
    keepingPlace(host, () => {
      replaceChildren(host, switches(false))
      scroller.scrollTop = 0
      document.documentElement.scrollLeft = 12
    })
    expect(scroller.scrollTop).toBe(430)
    expect(document.documentElement.scrollLeft).toBe(0)
  })

  it('moves the focus to the control drawn in its place', () => {
    const { host } = scrolledPage()
    replaceChildren(host, switches(true))
    const before = host.firstChild as HTMLElement
    before.focus()
    keepingPlace(host, () => replaceChildren(host, switches(false)))
    expect(document.activeElement).toBe(host.firstChild)
    expect(document.activeElement).not.toBe(before)
  })

  it('keeps the caret in a text that stayed the same, and not in one that changed', () => {
    const { host } = scrolledPage()
    const text = (value: string, caret: number) =>
      Object.assign(h('textarea', { value }), { selectionStart: caret, selectionEnd: caret })
    replaceChildren(host, text('Hello', 2))
    ;(host.firstChild as HTMLElement).focus()
    const caret = () => (host.firstChild as HTMLTextAreaElement).selectionStart
    keepingPlace(host, () => replaceChildren(host, text('Hello', 5)))
    expect(caret()).toBe(2)
    keepingPlace(host, () => replaceChildren(host, text('Other', 5)))
    expect(caret()).toBe(5)
    expect(document.activeElement).toBe(host.firstChild)
  })

  it('holds the new control where the old one was when what is above it changed size', () => {
    const { host, scroller } = scrolledPage()
    replaceChildren(host, switches(true))
    const used = host.firstChild as HTMLElement
    used.focus()
    Object.assign(used, { getBoundingClientRect: at(300) })
    keepingPlace(host, () => {
      const drawn = switches(false)
      Object.assign(drawn[0]!, { getBoundingClientRect: at(340) })
      replaceChildren(host, drawn)
    })
    expect([document.activeElement, scroller.scrollTop]).toEqual([host.firstChild, 470])
  })

  it('follows a row that moved by its key, and lets go once the row is gone', () => {
    const { host } = scrolledPage()
    const row = (key: string) =>
      h('li', { data: { key } }, h('span', {}, key), h('button', { class: 'todo-move' }, '↑'))
    replaceChildren(host, h('ol', {}, row('a'), row('b')), 'end')
    host.querySelector<HTMLElement>('[data-key="b"] .todo-move')!.focus()
    keepingPlace(host, () => replaceChildren(host, h('ol', {}, row('b'), row('a')), 'end'))
    expect(document.activeElement).toBe(host.querySelector('[data-key="b"] .todo-move'))
    keepingPlace(host, () => replaceChildren(host, h('ol', {}, row('a')), 'end'))
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves the focus alone when something else stands where the focused control stood', () => {
    const { host } = scrolledPage()
    const placesTaken = [
      () => replaceChildren(host, 'Saved'),
      () => replaceChildren(host, h('p', {}, 'Saved')),
      () => replaceChildren(host, h('button', { class: 'other' })),
      () => replaceChildren(host),
    ]
    for (const takePlace of placesTaken) {
      replaceChildren(host, switches(true))
      ;(host.firstChild as HTMLElement).focus()
      keepingPlace(host, takePlace)
      expect(document.activeElement).toBe(document.body)
    }
  })

  it('only runs the change when the focus is elsewhere', () => {
    const { host, scroller } = scrolledPage()
    const outside = h('button')
    document.body.append(outside)
    outside.focus()
    keepingPlace(host, () => {
      scroller.scrollTop = 0
    })
    expect(scroller.scrollTop).toBe(0)
    host.setAttribute('tabindex', '-1')
    host.focus()
    keepingPlace(host, () => {
      scroller.scrollTop = 10
    })
    expect([scroller.scrollTop, document.activeElement]).toEqual([10, host])
  })
})

describe('holdingStill', () => {
  it('scrolls the nearest container that can, and passes what it cannot to the next one', () => {
    const control = h('button', { class: 'note-more-text' }, 'Show less')
    const card = h('li', {}, control)
    const thread = h('div', { class: 'thread-scroll' }, card)
    const page = h('main', {}, thread)
    document.body.append(page)
    Object.assign(thread, { scrollHeight: 1000, clientHeight: 400, scrollTop: 250 })
    Object.assign(page, { scrollHeight: 2000, clientHeight: 800, scrollTop: 500 })
    let folded = false
    Object.assign(control, { getBoundingClientRect: () => ({ top: folded ? 100 : 500 }) })
    holdingStill(control, () => {
      folded = true
    })
    expect([card.scrollTop, thread.scrollTop, page.scrollTop]).toEqual([0, 0, 350])
    holdingStill(control, () => undefined)
    expect([thread.scrollTop, page.scrollTop]).toEqual([0, 350])
  })
})

describe('a region drawn again', () => {
  it('keeps the focus on the control the person used instead of dropping it with the old drawing', () => {
    const life = lifetime()
    const enabled = signal(true)
    const host = region(life, [enabled], () => [h('p', {}, 'Principles'), switches(enabled.get())])
    const { scroller } = scrolledPage()
    scroller.append(host)
    const around = host.parentElement
    const used = host.querySelector<HTMLElement>('.todo-switch')!
    used.focus()
    enabled.set(false)
    const drawn = host.querySelector('.todo-switch')!
    expect(drawn).not.toBe(used)
    expect(document.activeElement).toBe(drawn)
    expect(drawn.getAttribute('aria-checked')).toBe('false')
    expect([host.parentElement, scroller.scrollTop]).toEqual([around, 430])
    life.end()
  })
})
