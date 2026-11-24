import { type Lifetime, h, lifetime, signal } from '@homingbird/ui'
import { describe, expect, it } from 'vitest'
import { blocks } from '../../src/views/blocks.ts'
import { usingFakeDom } from '../support/dom.ts'

usingFakeDom()

describe('blocks', () => {
  it('draws a block again only when what it is drawn from changes, and ends each drawing', () => {
    const life = lifetime()
    const words = signal({ first: 'a', second: 'b', third: true })
    const ended: string[] = []
    const draw = (text: string) => (drawing: Lifetime) => {
      drawing.add(() => ended.push(text))
      return h('p', {}, text)
    }
    const host = blocks(life, h('div'), words, () => {
      const { first, second, third } = words.get()
      return [
        { key: 'first', from: first, draw: draw(first) },
        { key: 'second', from: second, draw: draw(second) },
        third ? { key: 'third', from: null, draw: draw('c') } : null,
      ]
    })
    const [first, second] = [...host.children]
    words.set({ first: 'a', second: 'B', third: false })
    expect(host.children[0]).toBe(first)
    expect(host.children[1]).not.toBe(second)
    expect(host.textContent).toBe('aB')
    expect(ended).toEqual(['b'])
    life.end()
    expect(ended.sort()).toEqual(['B', 'a', 'b', 'c'])
  })
})
