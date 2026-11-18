import { describe, expect, it } from 'vitest'
import { MARK, downscale, iconPixels, iconSvg, markPixels, markSvg } from '../src/brand-art.ts'
import { blank } from '../src/render.ts'
import { STATES } from '../src/states.ts'

describe('brand art', () => {
  it('uses the first idle frame as the mark', () => {
    expect(MARK).toBe(STATES.idle[0]!.rects)
  })

  it('draws the mark and the icon at the sizes asked for', () => {
    for (const size of [16, 32, 64]) expect(markPixels(size).width).toBe(size)
    for (const size of [180, 192]) expect(iconPixels(size).width).toBe(size)
  })

  it('writes crisp SVG with Pip on a rounded Night tile', () => {
    expect(markSvg()).toContain('shape-rendering="crispEdges"')
    expect(iconSvg()).toContain('fill="#22324E"')
  })

  it('keeps transparent areas transparent when shrinking', () => {
    expect(downscale(blank(4, 4), 2).data.every((value) => value === 0)).toBe(true)
  })
})
