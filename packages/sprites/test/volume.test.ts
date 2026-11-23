import { describe, expect, it } from 'vitest'
import { cellIndex, voxelAt } from '../src/volume.ts'

describe('volume', () => {
  const volume = {
    width: 2,
    length: 3,
    height: 2,
    cells: Array.from({ length: 12 }, (_, at) => (at === 11 ? { color: 'B', shaded: false } : null)),
  }

  it('counts cells slice by slice, then row by row', () => {
    expect(cellIndex(volume, 1, 2, 1)).toBe(11)
    expect(cellIndex(volume, 0, 1, 0)).toBe(2)
  })

  it('finds the voxel at a place, and nothing outside the stack', () => {
    expect(voxelAt(volume, 1, 2, 1)).toEqual({ color: 'B', shaded: false })
    expect(voxelAt(volume, 0, 0, 0)).toBeNull()
    expect(voxelAt(volume, 5, 0, 0)).toBeNull()
  })
})
