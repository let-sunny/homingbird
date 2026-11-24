import { PRESETS } from '@homingbird/sprites'
import { describe, expect, it } from 'vitest'
import { turnSheetUrl } from '../src/turn-sheets.ts'

const counting = () => {
  const drawn: Array<readonly [number, number]> = []
  return {
    drawn,
    page: {
      pngUrlOf: (image: { readonly width: number; readonly height: number }) => {
        drawn.push([image.width, image.height])
        return `data:image/png;${drawn.length}`
      },
    },
  }
}

describe('turnSheetUrl', () => {
  it('draws a character once, as 16 cells of 45 by 51 pixels, and reuses the address', () => {
    const { drawn, page } = counting()
    const fox = PRESETS.find((preset) => preset.id === 'fox')!
    const first = turnSheetUrl(fox, page)
    expect(turnSheetUrl({ ...fox, name: 'Another name' }, page)).toBe(first)
    expect(drawn).toEqual([[720, 51]])
  })

  it('draws a character with other colors or markings again', () => {
    const { drawn, page } = counting()
    const cat = PRESETS.find((preset) => preset.id === 'cat')!
    turnSheetUrl(cat, page)
    turnSheetUrl({ ...cat, palette: { ...cat.palette, B: '#000000' } }, page)
    turnSheetUrl({ ...cat, noFeet: true }, page)
    expect(drawn).toHaveLength(3)
  })

  it('keeps a bounded number of sheets, forgetting the oldest first', () => {
    const { drawn, page } = counting()
    const pigeon = PRESETS[0]!
    const shades = Array.from({ length: 33 }, (_, i) => ({
      ...pigeon,
      palette: { B: `#0000${i.toString(16).padStart(2, '0')}` },
    }))
    for (const spec of shades) turnSheetUrl(spec, page)
    turnSheetUrl(shades[0]!, page)
    expect(drawn).toHaveLength(34)
  }, 20_000)
})
