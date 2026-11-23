import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type View, carveViews, fit } from '../src/carve.ts'
import { voxelAt } from '../src/volume.ts'

const filled = (
  width: number,
  height: number,
  key: string | ((row: number, column: number) => string | null),
): View => ({
  width,
  height,
  keys: Array.from({ length: width * height }, (_, at) =>
    typeof key === 'string' ? key : key(Math.floor(at / width), at % width),
  ),
})

const solidCount = (cells: ReadonlyArray<unknown>) => cells.filter((cell) => cell !== null).length

describe('fit', () => {
  it('picks the source pixel under each target pixel centre', () => {
    const line = { width: 4, height: 1, keys: ['a', 'b', 'c', 'd'] }
    expect(fit(line, 6, 1).keys).toEqual(['a', 'b', 'b', 'c', 'd', 'd'])
    expect(fit(line, 2, 1).keys).toEqual(['b', 'd'])
  })

  it('keeps a picture the same when the size is the same', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('B', 'D', null), { minLength: 12, maxLength: 12 }), (keys) => {
        const view = { width: 4, height: 3, keys }
        expect(fit(view, 4, 3)).toEqual(view)
      }),
    )
  })
})

describe('carveViews', () => {
  it('rounds a box seen as squares from every side into a cylinder-like lathe', () => {
    const volume = carveViews(
      { top: filled(8, 8, 'B'), side: filled(8, 8, 'B'), front: filled(8, 8, 'B'), back: filled(8, 8, 'B') },
      8,
    )
    expect([volume.width, volume.length, volume.height]).toEqual([8, 8, 8])
    expect(voxelAt(volume, 4, 4, 4)).not.toBeNull()
    expect(voxelAt(volume, 4, 0, 0)).toBeNull()
    expect(solidCount(volume.cells)).toBeLessThan(8 * 8 * 8)
  })

  it('keeps separate posts square instead of rounding across the gap', () => {
    const posts = (row: number, column: number) => (column === 0 || column === 3 ? 'F' : null)
    const volume = carveViews(
      {
        top: filled(4, 4, 'F'),
        side: filled(4, 4, 'F'),
        front: filled(4, 4, posts),
        back: filled(4, 4, posts),
      },
      4,
    )
    expect(voxelAt(volume, 0, 0, 0)?.color).toBe('F')
    expect(voxelAt(volume, 0, 0, 1)).toBeNull()
  })

  it('colors the top from above and the flanks from the side, shading edges below a step', () => {
    const top = filled(6, 6, 'T')
    const side = filled(6, 6, (row) => (row < 2 ? null : 'S'))
    const sideWithCap = filled(6, 6, (row, column) => (row < 2 && (column < 2 || column > 3) ? null : 'S'))
    const volume = carveViews(
      { top, side: { ...side, keys: sideWithCap.keys }, front: filled(6, 6, 'S'), back: filled(6, 6, 'S') },
      6,
    )
    expect(voxelAt(volume, 5, 2, 2)).toEqual({ color: 'T', shaded: false })
    const below = voxelAt(volume, 3, 0, 2)
    expect(below?.shaded).toBe(true)
  })

  it('takes a covered voxel deep inside a slice from the one above it', () => {
    const volume = carveViews(
      { top: filled(9, 9, 'T'), side: filled(9, 9, 'S'), front: filled(9, 9, 'S'), back: filled(9, 9, 'S') },
      9,
    )
    expect(voxelAt(volume, 3, 4, 4)).toEqual(voxelAt(volume, 4, 4, 4))
  })

  it('colors from the front and back views where an edge faces the beak or the tail', () => {
    const volume = carveViews(
      { top: filled(6, 6, 'T'), side: filled(6, 6, 'S'), front: filled(6, 6, 'F'), back: filled(6, 6, 'K') },
      6,
    )
    const colors = new Set(volume.cells.map((voxel) => voxel?.color))
    expect(colors).toEqual(new Set([undefined, 'T', 'S', 'F', 'K']))
  })

  it('falls back to the top color where a facing view has nothing drawn on that row', () => {
    const volume = carveViews(
      {
        top: filled(6, 6, 'T'),
        side: filled(6, 6, 'S'),
        front: filled(6, 6, (row) => (row === 5 ? null : 'F')),
        back: filled(6, 6, 'K'),
      },
      6,
    )
    expect(volume.cells.some((voxel) => voxel?.color === 'T' && voxel.shaded)).toBe(true)
  })
})
