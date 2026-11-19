import type { RoutePoint } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MAX_MARKERS, lineWidth, routeLayout } from '../src/route-map.ts'

const point = (changes: Partial<RoutePoint> = {}): RoutePoint => ({
  place: 'billing',
  drafted: 3,
  principles: 0,
  heldUp: 0,
  chances: 0,
  ...changes,
})

describe('lineWidth', () => {
  it('never shrinks as more is taught or holds up, and stays within bounds', () => {
    fc.assert(
      fc.property(fc.nat({ max: 500 }), fc.nat({ max: 50 }), (strength, more) => {
        expect(lineWidth(strength + more)).toBeGreaterThanOrEqual(lineWidth(strength))
        expect(lineWidth(strength)).toBeGreaterThanOrEqual(1)
        expect(lineWidth(strength)).toBeLessThanOrEqual(8)
      }),
    )
  })
})

describe('routeLayout', () => {
  it('puts each place on a circle around the person, the first one on top', () => {
    const nodes = routeLayout([point(), point({ place: null }), point({ place: 'payroll' })], 300)
    expect(nodes[0]).toMatchObject({ x: 150, y: 42 })
    for (const node of nodes) expect(Math.hypot(node.x - 150, node.y - 150)).toBeCloseTo(108, 0)
  })

  it('grows a line with principles and their successes, and never thins it for edits or discards', () => {
    const [plain, taught, corrected] = routeLayout(
      [point(), point({ principles: 2, heldUp: 6 }), point({ principles: 2, heldUp: 6, chances: 40 })],
      300,
    )
    expect(taught!.width).toBeGreaterThan(plain!.width)
    expect(corrected!.width).toBe(taught!.width)
    expect(corrected!.chances).toBe(MAX_MARKERS)
    expect(plain!.taught).toBe(false)
  })
})
