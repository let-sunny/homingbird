import { describe, expect, it } from 'vitest'
import { GRID } from '../src/grid.ts'
import { BODY, BODY_TAIL, mirror, sendingFrames, shift } from '../src/pip-parts.ts'

describe('pip parts', () => {
  it('ends the body with the tail rectangle that markings follow', () => {
    expect(BODY.at(-1)).toEqual(BODY_TAIL)
  })

  it('mirrors across the grid and back to where it started', () => {
    const rects = mirror(BODY)
    expect(rects.every(([x, , w]) => x >= 0 && x + w <= GRID)).toBe(true)
    expect(mirror(rects)).toEqual(BODY)
  })

  it('shifts every rectangle by the same offset', () => {
    expect(shift([[1, 2, 3, 4, 'B']], 2, -1)).toEqual([[3, 1, 3, 4, 'B']])
  })

  it('flaps up, middle, down, middle while sending, bobbing on the middle two', () => {
    expect(sendingFrames().map((frame) => frame.bob)).toEqual([0, 1, 1, 0])
  })
})
