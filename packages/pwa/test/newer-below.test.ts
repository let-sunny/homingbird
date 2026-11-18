import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { changedItems, showsNewerBelow, unseenAfterDraw } from '../src/newer-below.ts'

const view = (overrides: Partial<Parameters<typeof showsNewerBelow>[0]> = {}) => ({
  order: ['a', 'b', 'c', 'd'],
  unseen: new Set<string>(),
  inView: new Set(['a', 'b']),
  atBottom: false,
  ...overrides,
})

describe('showsNewerBelow', () => {
  it('shows nothing while scrolling through notes already seen, even far from the bottom', () => {
    expect(showsNewerBelow(view())).toBe(false)
  })

  it('points at an unseen item below the view', () => {
    expect(showsNewerBelow(view({ unseen: new Set(['d']) }))).toBe(true)
  })

  it('ignores unseen items above or inside the view', () => {
    expect(showsNewerBelow(view({ unseen: new Set(['a']), inView: new Set(['c', 'd']) }))).toBe(false)
    expect(showsNewerBelow(view({ unseen: new Set(['b']) }))).toBe(false)
  })

  it('never shows at the bottom', () => {
    expect(showsNewerBelow(view({ unseen: new Set(['d']), atBottom: true }))).toBe(false)
  })

  it('is never shown when nothing is unseen, whatever the position', () => {
    fc.assert(
      fc.property(fc.subarray(['a', 'b', 'c', 'd']), fc.boolean(), (inView, atBottom) => {
        expect(showsNewerBelow(view({ inView: new Set(inView), atBottom }))).toBe(false)
      }),
    )
  })
})

describe('changedItems and unseenAfterDraw', () => {
  it('collects what arrived or changed while scrolled up, and forgets it once at the bottom', () => {
    const before = new Map([
      ['a', '1'],
      ['b', '1'],
    ])
    const after = new Map([
      ['a', '1'],
      ['b', '2'],
      ['c', '1'],
    ])
    const changed = changedItems(before, after)
    expect(changed).toEqual(['b', 'c'])
    expect([...unseenAfterDraw(new Set(['x']), changed, false)]).toEqual(['x', 'b', 'c'])
    expect([...unseenAfterDraw(new Set(['x']), changed, true)]).toEqual([])
  })
})
