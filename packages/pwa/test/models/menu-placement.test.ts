import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { menuPlacement, pointAnchor } from '../../src/models/menu-placement.ts'

const viewport = { width: 400, height: 300 }
const menu = { width: 200, height: 100 }

describe('menuPlacement', () => {
  it('opens below a pointer from where it pressed, and ends under the end of a button', () => {
    expect(menuPlacement({ anchor: pointAnchor({ x: 50, y: 60 }), menu, viewport, align: 'start' })).toEqual({
      x: 50,
      y: 64,
    })
    expect(
      menuPlacement({ anchor: { left: 300, right: 320, top: 20, bottom: 40 }, menu, viewport, align: 'end' }),
    ).toEqual({ x: 120, y: 44 })
  })

  it('opens above where there is no room below, and keeps clear of every edge', () => {
    expect(
      menuPlacement({ anchor: pointAnchor({ x: 390, y: 290 }), menu, viewport, align: 'start' }),
    ).toEqual({
      x: 192,
      y: 186,
    })
    expect(menuPlacement({ anchor: pointAnchor({ x: 2, y: 2 }), menu, viewport, align: 'start' })).toEqual({
      x: 8,
      y: 8,
    })
  })

  it('stays below when there is room neither below nor above, pinned to the top', () => {
    const tall = { width: 200, height: 280 }
    expect(
      menuPlacement({ anchor: pointAnchor({ x: 10, y: 150 }), menu: tall, viewport, align: 'start' }),
    ).toEqual({ x: 10, y: 12 })
  })

  it('keeps a menu that fits wholly on screen', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 300 }),
        fc.constantFrom('start' as const, 'end' as const),
        (x, y, align) => {
          const spot = menuPlacement({ anchor: pointAnchor({ x, y }), menu, viewport, align })
          return spot.x >= 8 && spot.y >= 8 && spot.x + menu.width <= 392 && spot.y + menu.height <= 292
        },
      ),
    )
  })
})
