import { describe, expect, it } from 'vitest'
import { blank, hexOf, paste, rasterize, roundHalfEven, sheetLayout } from '../src/render.ts'
import { STATES } from '../src/states.ts'

describe('render', () => {
  it('rounds halves to the even neighbour', () => {
    expect([0.5, 1.5, 2.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, 2, 3])
  })

  it('looks colors up in the palette, then the sprite colors, and passes hex through', () => {
    expect(hexOf('B', { B: '#123456' })).toBe('#123456')
    expect(hexOf('B')).toBe('#8DA4CB')
    expect(hexOf('#ABCDEF')).toBe('#ABCDEF')
    expect(() => hexOf('Q')).toThrow('unknown sprite color Q')
  })

  it('fills whole cells at the scale it is given and clips at the edges', () => {
    const image = rasterize([[15, 16, 4, 4, '#FF0000']], 2)
    expect([...image.data.subarray((33 * 32 + 31) * 4, (33 * 32 + 31) * 4 + 4)]).toEqual([255, 0, 0, 255])
  })

  it('pastes only opaque pixels and ignores what falls outside', () => {
    const target = blank(2, 2)
    const source = rasterize([[0, 0, 1, 1, '#00FF00']], 1)
    paste(target, source, 1, 1)
    paste(target, source, 5, 5)
    expect([...target.data.subarray(12, 16)]).toEqual([0, 255, 0, 255])
    expect(target.data.subarray(0, 12).every((value) => value === 0)).toBe(true)
  })

  it('lays the sheet out one row per state', () => {
    const layout = sheetLayout(STATES)
    expect(layout.sending?.[2]).toEqual({ x: 32, y: 17 * 10, w: 16, h: 17, ms: 140 })
  })
})
