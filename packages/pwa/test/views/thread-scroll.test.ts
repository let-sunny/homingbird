import { lifetime } from '@homingbird/ui'
import { fire } from '@homingbird/ui/testing'
import { describe, expect, it } from 'vitest'
import { followNewNotes, markReadWhenSeen } from '../../src/views/thread-scroll.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ANA, ROOM, note } from '../support/fixtures.ts'

usingFakeDom()

const element = (key: string, unread = false) => {
  const item = document.createElement('li')
  item.dataset.noteId = key
  item.dataset.unread = String(unread)
  return item
}

describe('followNewNotes', () => {
  it('stays at the bottom, and points at unseen news below once the person scrolled up', () => {
    const { context, page } = testContext()
    const life = lifetime()
    const scroller = document.createElement('div')
    const indicator = document.createElement('button')
    let signatures: Array<readonly [string, string]> = [['a', '1']]
    const follow = followNewNotes(context, life, scroller, indicator, () => signatures)
    const a = follow.track('a', element('a', true))
    follow.afterDraw()
    page.runFrames()
    expect(indicator.hidden).toBe(true)
    Object.assign(scroller, { scrollHeight: 1000, scrollTop: 0, clientHeight: 100 })
    fire.event(scroller, 'scroll')
    expect(indicator.hidden).toBe(false)
    page.inView([a])
    expect(indicator.hidden).toBe(true)
    const b = follow.track('b', element('b'))
    follow.track('b', b)
    signatures = [
      ['a', '1'],
      ['b', '1'],
    ]
    follow.afterDraw()
    expect(indicator.hidden).toBe(false)
    page.inView([a], false)
    indicator.click()
    Object.assign(scroller, { scrollTop: 900 })
    fire.event(scroller, 'scroll')
    expect(indicator.hidden).toBe(true)
    signatures = [['b', '1']]
    follow.afterDraw()
    life.end()
    expect(page.watches.every((watch) => watch.disconnected)).toBe(true)
  })
})

describe('followNewNotes.pin', () => {
  it('goes back to the bottom at once and stays there for what arrives next', () => {
    const { context, page } = testContext()
    const scroller = document.createElement('div')
    const scrolled: unknown[] = []
    scroller.scrollTo = ((options: unknown) => void scrolled.push(options)) as typeof scroller.scrollTo
    const indicator = document.createElement('button')
    let signatures: Array<readonly [string, string]> = [['a', '1']]
    const follow = followNewNotes(context, lifetime(), scroller, indicator, () => signatures)
    follow.track('a', element('a'))
    follow.afterDraw()
    page.runFrames()
    Object.assign(scroller, { scrollHeight: 3000, scrollTop: 200, clientHeight: 500 })
    fire.event(scroller, 'scroll')
    follow.track('b', element('b'))
    signatures = [...signatures, ['b', '1']]
    follow.afterDraw()
    page.runFrames()
    expect(indicator.hidden).toBe(false)
    scrolled.length = 0
    follow.pin()
    expect(scrolled).toEqual([{ top: 3000, behavior: 'instant' }])
    expect(indicator.hidden).toBe(true)
    follow.track('c', element('c'))
    signatures = [...signatures, ['c', '1']]
    follow.afterDraw()
    page.runFrames()
    expect(scrolled).toEqual([{ top: 3000, behavior: 'instant' }, { top: 3000 }])
    expect(indicator.hidden).toBe(true)
  })
})

describe('markReadWhenSeen', () => {
  it('marks unread notes read once in view while the page is visible', () => {
    const { context, called, page } = testContext()
    const unread = note('n1', {
      receipts: [
        {
          memberId: ANA,
          state: 'delivered',
          deliveredAt: 1,
          readAt: null,
          draftingAt: null,
          repliedAt: null,
        },
      ],
    })
    const seen = markReadWhenSeen(context, lifetime(), document.createElement('div'), ANA, ROOM, (id) =>
      id === 'n1' ? unread : null,
    )
    const item = seen.watch(element('n1', true))
    seen.watch(element('n2'))
    page.state.visible = false
    page.inView([item])
    page.state.visible = true
    page.inView([item])
    page.inView([item])
    expect(called('markRead').map((call) => call.args)).toEqual([[unread]])
  })

  it('waits for the person to act before reading a conversation that opened by itself', () => {
    const { context, called, page } = testContext()
    context.state.openedForThePerson.set(ROOM)
    const unread = note('n1', {
      receipts: [
        {
          memberId: ANA,
          state: 'delivered',
          deliveredAt: 1,
          readAt: null,
          draftingAt: null,
          repliedAt: null,
        },
      ],
    })
    const scroller = document.createElement('div')
    const life = lifetime()
    const seen = markReadWhenSeen(context, life, scroller, ANA, ROOM, () => unread)
    expect(scroller.dataset.reading).toBe('waiting-for-the-person')
    const item = seen.watch(element('n1', true))
    page.inView([item])
    page.inView([item], false)
    page.inView([item])
    expect(called('markRead')).toHaveLength(0)
    fire.event(document.body, 'keydown', { isTrusted: false })
    expect(called('markRead')).toHaveLength(0)
    fire.event(document.body, 'pointerdown')
    fire.event(document.body, 'pointerdown')
    expect(called('markRead')).toHaveLength(1)
    expect(context.state.openedForThePerson.get()).toBeNull()
    expect(scroller.dataset.reading).toBeUndefined()
    life.end()
  })
})
