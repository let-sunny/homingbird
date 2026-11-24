import { h, lifetime, region, signal } from '@homingbird/ui'
import { fire } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { unlessComposing } from '../../src/views/composing.ts'
import { testContext } from '../support/context.ts'
import { mount, usingFakeDom } from '../support/dom.ts'

usingFakeDom()

const shown = () => {
  const { context, page } = testContext()
  const life = lifetime()
  const words = signal('one')
  const field = h('textarea')
  const { drawn, watch } = unlessComposing(context, life, words)
  const host = mount(watch(region(life, [drawn], () => [h('p', {}, words.get()), field])))
  return { page, life, words, field, text: () => host.querySelector('p')!.textContent }
}

describe('unlessComposing', () => {
  it('follows its source until its lifetime ends', () => {
    const { life, words, text } = shown()
    words.set('two')
    expect(text()).toBe('two')
    life.end()
    words.set('three')
    expect(text()).toBe('two')
  })

  it('waits while a character is being composed, and for the next one begun at once', () => {
    const { page, words, field, text } = shown()
    fire.event(field, 'compositionstart')
    words.set('two')
    fire.event(field, 'compositionend')
    fire.event(field, 'compositionstart')
    page.runFrames()
    expect(text()).toBe('one')
    fire.event(field, 'compositionend')
    page.runFrames()
    expect(text()).toBe('two')
  })

  it('does not wait for a field that left the page before its composition ended', () => {
    const { words, field, text } = shown()
    fire.event(field, 'compositionstart')
    field.remove()
    words.set('two')
    expect(text()).toBe('two')
  })
})
