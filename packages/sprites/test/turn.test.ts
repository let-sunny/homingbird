import { describe, expect, it } from 'vitest'
import { BIRD_SLICES } from '../src/bird-slices.ts'
import { rgbOf } from '../src/color.ts'
import { COLORS } from '../src/grid.ts'
import type { Pixels } from '../src/render.ts'
import { decodeSlices } from '../src/slices.ts'
import { TURN_DIRECTIONS, renderTurn, turnCellOf, turnSheet } from '../src/turn.ts'
import type { Volume } from '../src/volume.ts'

const body = decodeSlices(BIRD_SLICES)

const colorsIn = (image: Pixels): Set<string> => {
  const found = new Set<string>()
  for (let at = 0; at < image.data.length; at += 4)
    if (image.data[at + 3] !== 0) found.add([...image.data.subarray(at, at + 3)].join(','))
  return found
}

describe('turn', () => {
  it('measures the cell every direction of the shared body fits in', () => {
    expect(turnCellOf(body)).toEqual(BIRD_SLICES.cell)
  })

  it('lays the directions out in one row of equal cells', () => {
    const sheet = turnSheet(body, BIRD_SLICES.cell)
    expect([sheet.width, sheet.height]).toEqual([
      BIRD_SLICES.cell.width * TURN_DIRECTIONS,
      BIRD_SLICES.cell.height,
    ])
  })

  it('draws one ink outline around the stack', () => {
    const frame = renderTurn(body, 0, {})
    expect(colorsIn(frame)).toContain(rgbOf(COLORS.K).join(','))
  })

  it('colors every voxel from the palette it is given', () => {
    const plain = colorsIn(renderTurn(body, 90, {}))
    const red = colorsIn(renderTurn(body, 90, { B: '#FF0000' }))
    expect(plain).toContain(rgbOf(COLORS.B).join(','))
    expect(red).toContain('255,0,0')
    expect(red).not.toContain(rgbOf(COLORS.B).join(','))
  })

  it('shades a voxel darker the nearer it is to the ground', () => {
    const column = (shaded: boolean): Volume => ({
      width: 1,
      length: 1,
      height: 3,
      cells: [0, 1, 2].map(() => ({ color: '#C8C8C8', shaded })),
    })
    const shaded = [...colorsIn(renderTurn(column(true), 0, {}))].filter(
      (rgb) => rgb !== rgbOf(COLORS.K).join(','),
    )
    expect(shaded.map((rgb) => Number(rgb.split(',')[0])).sort()).toEqual([158, 173, 188])
    expect(colorsIn(renderTurn(column(false), 0, {}))).toContain('200,200,200')
  })
})
