import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeSlices, encodeSlices, slicesModule } from '../src/slices.ts'
import type { Voxel } from '../src/volume.ts'

const cell = { left: 0, top: 0, width: 1, height: 1 }

const voxel: fc.Arbitrary<Voxel | null> = fc.oneof(
  fc.constant(null),
  fc.record({ color: fc.constantFrom('B', 'D', 'O', 'F', 'K'), shaded: fc.boolean() }),
)

describe('slices', () => {
  it('decodes exactly what it encoded', () => {
    fc.assert(
      fc.property(fc.array(voxel, { minLength: 12, maxLength: 12 }), (cells) => {
        const volume = { width: 2, length: 3, height: 2, cells }
        expect(decodeSlices(encodeSlices(volume, cell))).toEqual(volume)
      }),
    )
  })

  it('writes a letter per voxel, lower case when shaded, with a count for a run', () => {
    const cells = [null, null, null, { color: 'B', shaded: false }, { color: 'B', shaded: true }]
    expect(encodeSlices({ width: 5, length: 1, height: 1, cells }, cell).voxels).toBe('.3Bb')
  })

  it('refuses a marking color, which belongs to a character and not to the shared body', () => {
    const cells = [{ color: '#FF0000', shaded: false }]
    expect(() => encodeSlices({ width: 1, length: 1, height: 1, cells }, cell)).toThrow(/palette keys only/)
  })

  it('writes the slices as a module', () => {
    const slices = encodeSlices({ width: 1, length: 1, height: 1, cells: [null] }, cell)
    expect(slicesModule(slices)).toContain(`export const BIRD_SLICES: BirdSlices = ${JSON.stringify(slices)}`)
  })
})
