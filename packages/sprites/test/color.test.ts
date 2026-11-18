import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { contrast, distance, hsl, luminance, rgbOf } from '../src/color.ts'

const hex = fc
  .integer({ min: 0, max: 0xffffff })
  .map((value) => `#${value.toString(16).padStart(6, '0').toUpperCase()}`)

describe('color', () => {
  it('gives black on white the full 21:1 contrast', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21)
    expect(luminance('#FFFFFF')).toBeCloseTo(1)
  })

  it('measures contrast and distance the same either way round', () => {
    fc.assert(
      fc.property(hex, hex, (a, b) => {
        expect(contrast(a, b)).toBeCloseTo(contrast(b, a))
        expect(distance(a, b)).toBeCloseTo(distance(b, a))
        expect(contrast(a, b)).toBeGreaterThanOrEqual(1)
      }),
    )
  })

  it('reads back the channels it writes', () => {
    expect(rgbOf('#1B2333')).toEqual([27, 35, 51])
    expect(hsl(0, 100, 50)).toBe('#FF0000')
    expect(hsl(210, 0, 100)).toBe('#FFFFFF')
  })
})
