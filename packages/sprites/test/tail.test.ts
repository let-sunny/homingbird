import { describe, expect, it } from 'vitest'
import { carveBird } from '../src/bird-3d.ts'
import { TAIL_REACH, addTail } from '../src/tail.ts'
import { type Volume, voxelAt } from '../src/volume.ts'

const air: Volume = {
  width: 12,
  length: 20,
  height: 10,
  cells: Array.from({ length: 12 * 20 * 10 }, () => null),
}

const rows = (volume: Volume) => Array.from({ length: volume.length }, (_, row) => row)

const columnsAt = (volume: Volume, z: number, row: number) =>
  Array.from({ length: volume.width }, (_, column) => column).filter(
    (column) => voxelAt(volume, z, row, column) !== null,
  )

const firstRowAt = (volume: Volume, z: number) =>
  rows(volume).findIndex((row) => columnsAt(volume, z, row).length > 0)

describe('addTail', () => {
  const tail = addTail(air)

  it('steps down and back to a point in the body color', () => {
    expect([0, 2, 4].map((z) => firstRowAt(tail, z))).toEqual([0, 1, 3])
    expect(columnsAt(tail, 0, 0)).toHaveLength(2)
    expect(columnsAt(tail, 4, 9).length).toBeGreaterThan(columnsAt(tail, 2, 3).length)
    expect(new Set(tail.cells.map((voxel) => voxel?.color))).toEqual(new Set([undefined, 'B']))
  })

  it('is the same on both flanks', () => {
    for (let z = 0; z < tail.height; z++)
      for (const row of rows(tail))
        for (const column of columnsAt(tail, z, row))
          expect(voxelAt(tail, z, row, tail.width - 1 - column)).toEqual(voxelAt(tail, z, row, column))
  })

  it('lights the top of each step and shades what is under it', () => {
    expect(voxelAt(tail, 1, 0, 6)).toEqual({ color: 'B', shaded: false })
    expect(voxelAt(tail, 0, 0, 6)).toEqual({ color: 'B', shaded: true })
    expect(voxelAt(tail, 3, 5, 6)).toEqual({ color: 'B', shaded: true })
  })

  it('keeps the body as it is, in the middle of the longer volume', () => {
    const solid: Volume = { ...air, cells: air.cells.map(() => ({ color: 'D', shaded: false })) }
    const tailed = addTail(solid)
    expect(tailed.length).toBe(solid.length + 2 * TAIL_REACH)
    expect(tailed.cells.filter((voxel) => voxel?.color === 'D')).toHaveLength(solid.cells.length)
    expect(voxelAt(tailed, 0, TAIL_REACH, 0)?.color).toBe('D')
    expect(voxelAt(tailed, 0, TAIL_REACH - 1, 0)).toBeNull()
  })
})

describe("the turning bird's tail", () => {
  const body = carveBird()

  it('is the rearmost and the lowest thing from the side, as on the flat sprite', () => {
    const rearmost = Math.min(
      ...Array.from({ length: body.height }, (_, z) => firstRowAt(body, z)).filter((row) => row >= 0),
    )
    expect(rearmost).toBe(0)
    expect([0, 1].map((z) => firstRowAt(body, z))).toEqual([0, 0])
    for (let z = 6; z < body.height; z++)
      if (firstRowAt(body, z) >= 0) expect(firstRowAt(body, z)).toBeGreaterThanOrEqual(TAIL_REACH)
  })

  it('leaves air between itself and the feet on the ground', () => {
    const filled = rows(body).map((row) => columnsAt(body, 0, row).length > 0)
    const gap = filled.indexOf(false)
    const feet = filled.indexOf(true, gap)
    expect(feet - gap).toBeGreaterThan(5)
    expect(new Set(columnsAt(body, 0, feet).map((column) => voxelAt(body, 0, feet, column)?.color))).toEqual(
      new Set(['F']),
    )
  })

  it('is joined to the body', () => {
    const seam = rows(body).slice(0, 14)
    const heights = seam.map((row) => [4, 5].some((z) => voxelAt(body, z, row, body.width / 2) !== null))
    expect(heights.slice(heights.indexOf(true))).not.toContain(false)
  })
})
