import { describe, expect, it } from 'vitest'
import { carveBird } from '../src/bird-3d.ts'
import { dressBird, gridPointOf, paintFlanks } from '../src/flank-decals.ts'
import { TAIL_REACH } from '../src/tail.ts'
import { type Volume, voxelAt } from '../src/volume.ts'

/** One slice, one row: a bar of six voxels across. */
const bar: Volume = {
  width: 8,
  length: 1,
  height: 1,
  cells: Array.from({ length: 8 }, (_, column) =>
    column > 0 && column < 7 ? { color: 'B', shaded: true } : null,
  ),
}

const colorsOf = (volume: Volume) => volume.cells.map((voxel) => voxel?.color ?? '.').join('')

describe('paintFlanks', () => {
  it('paints the outermost voxels of both flanks, as deep as asked', () => {
    expect(colorsOf(paintFlanks(bar, 2, () => ({ color: 'D', shaded: false })))).toBe('.DDBBDD.')
  })

  it('leaves places the decal does not cover alone', () => {
    expect(paintFlanks(bar, 2, () => null)).toEqual(bar)
  })
})

describe('gridPointOf', () => {
  it("puts Pip's 3D eye where the eye is on the flat sprite", () => {
    const [x, y] = gridPointOf(21 + TAIL_REACH, 17)
    expect(Math.floor(x)).toBe(11)
    expect(Math.floor(y)).toBe(6)
  })

  it('spans the flat body from tail to beak and from crown to ground', () => {
    expect(gridPointOf(1.5 + TAIL_REACH, 25.5)).toEqual([1, 2])
    expect(gridPointOf(26.5 + TAIL_REACH, 1.5)).toEqual([14, 14])
  })

  it('keeps the point of the tail on the first cell of the flat sprite', () => {
    expect(gridPointOf(0, 0)[0]).toBe(0)
    expect(Math.floor(gridPointOf(0, 0)[1])).toBe(14)
  })
})

describe('dressBird', () => {
  const body = carveBird()

  it('paints a marking on both flanks where the side view puts it', () => {
    const dressed = dressBird(body, { marks: [[1, 2, 13, 13, '#FF0000']] })
    const red = dressed.cells.filter((voxel) => voxel?.color === '#FF0000').length
    expect(red).toBeGreaterThan(100)
    expect(voxelAt(dressed, 13, 14, 13)).toEqual(voxelAt(body, 13, 14, 13))
  })

  it('paints a tail marking on every voxel of the point of the tail', () => {
    const tipped = dressBird(body, { marks: [[0, 14, 1, 1, '#FF0000']] })
    const point = tipped.cells.slice(0, body.width * 2).filter((voxel) => voxel !== null)
    expect(new Set(point.map((voxel) => voxel.color))).toEqual(new Set(['#FF0000']))
  })

  it('takes the feet away from a character without feet, and keeps them otherwise', () => {
    const hasFeet = (volume: Volume) => volume.cells.some((voxel) => voxel?.color === 'F')
    expect(hasFeet(dressBird(body, { marks: [] }))).toBe(true)
    expect(hasFeet(dressBird(body, { marks: [], noFeet: true }))).toBe(false)
  })
})
