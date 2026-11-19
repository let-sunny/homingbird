import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { append, h, linkedText, replaceChildren, svg } from '../src/element.ts'
import { installFakeDom, uninstallFakeDom } from '../src/testing/index.ts'

beforeEach(() => installFakeDom())
afterEach(() => uninstallFakeDom())

describe('h', () => {
  it('sets class, data, listeners, form values and other attributes, skipping empty ones', () => {
    const clicked = vi.fn()
    const button = h(
      'button',
      {
        class: 'primary',
        data: { draftId: 'd1' },
        on: { click: clicked },
        hidden: true,
        title: 'Send',
        skipped: false,
        missing: null,
        gone: undefined,
      },
      'Send',
      3,
      null,
      false,
      undefined,
      ['!'],
    )
    button.click()
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(button.className).toBe('primary')
    expect(button.dataset.draftId).toBe('d1')
    expect(button.getAttribute('hidden')).toBe('')
    expect(button.getAttribute('title')).toBe('Send')
    expect(button.hasAttribute('skipped')).toBe(false)
    expect(button.textContent).toBe('Send3!')
    const input = h('input', { value: 'typed', checked: true })
    expect([input.value, input.checked, input.hasAttribute('value')]).toEqual(['typed', true, false])
    expect(h('div', { value: 'kept' }).getAttribute('value')).toBe('kept')
    expect(h('p').childNodes).toHaveLength(0)
  })
})

describe('append and replaceChildren', () => {
  it('flattens children and replaces what was there', () => {
    const list = h('ul', {}, h('li', {}, 'old'))
    replaceChildren(list, [h('li', {}, 'a'), [h('li', {}, 'b')]], 'c')
    expect(list.textContent).toBe('abc')
    append(list, null)
    expect(list.childNodes).toHaveLength(3)
  })
})

describe('linkedText', () => {
  it('turns web addresses into links that open safely, and leaves the rest as text', () => {
    const [before, link, after] = linkedText('See https://example.com/a. Thanks') as unknown as [
      Node,
      HTMLAnchorElement,
      Node,
    ]
    expect(before.textContent).toBe('See ')
    expect([link.getAttribute('href'), link.getAttribute('rel'), link.getAttribute('target')]).toEqual([
      'https://example.com/a',
      'noopener noreferrer',
      '_blank',
    ])
    expect(after.textContent).toBe('. Thanks')
  })
})

describe('svg', () => {
  it('builds an SVG element with its attributes and children', () => {
    const circle = svg('circle', { r: 4, class: 'dot' })
    const group = svg('g', { transform: 'translate(1 2)' }, circle)
    expect([group.tagName.toLowerCase(), group.getAttribute('transform')]).toEqual(['g', 'translate(1 2)'])
    expect([circle.getAttribute('r'), circle.getAttribute('class')]).toEqual(['4', 'dot'])
    expect(group.firstChild).toBe(circle)
  })
})
