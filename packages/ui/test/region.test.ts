import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { h } from '../src/element.ts'
import { keyedRegion, lifetime, region } from '../src/region.ts'
import { signal } from '../src/signal.ts'
import { installFakeDom, uninstallFakeDom } from '../src/testing/index.ts'

beforeEach(() => installFakeDom())
afterEach(() => uninstallFakeDom())

describe('lifetime', () => {
  it('releases everything added to it once, when it ends', () => {
    const life = lifetime()
    const released: number[] = []
    life.add(() => released.push(1))
    life.add(() => released.push(2))
    life.end()
    life.end()
    expect(released).toEqual([1, 2])
  })
})

describe('region', () => {
  it('redraws when a source changes, until its lifetime ends', () => {
    const life = lifetime()
    const count = signal(1)
    const host = region(life, [count], () => `count ${count.get()}`, { data: { part: 'count' } })
    expect([host.className, host.dataset.part, host.textContent]).toEqual(['region', 'count', 'count 1'])
    count.set(2)
    expect(host.textContent).toBe('count 2')
    life.end()
    count.set(3)
    expect(host.textContent).toBe('count 2')
    expect(region(lifetime(), [], () => null, { class: 'x' }).className).toBe('x')
  })
})

describe('keyedRegion', () => {
  it('keeps unchanged items, redraws changed ones, and follows the new order', () => {
    const life = lifetime()
    const items = signal([
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ])
    let drawn = 0
    const host = keyedRegion(life, h('ul'), [items], () => items.get(), {
      key: (item) => item.id,
      signature: (item) => item.text,
      render: (item) => {
        drawn++
        return h('li', {}, item.text)
      },
    })
    const first = host.firstChild
    items.set([
      { id: 'c', text: 'C' },
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B2' },
    ])
    expect(host.textContent).toBe('CAB2')
    expect(host.childNodes[1]).toBe(first)
    items.set([{ id: 'b', text: 'B2' }])
    expect(host.textContent).toBe('B2')
    expect(drawn).toBe(4)
  })
})
