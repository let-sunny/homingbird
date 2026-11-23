import { describe, expect, it } from 'vitest'
import { carveBird } from '../src/bird-3d.ts'
import { BIRD_SLICES } from '../src/bird-slices.ts'
import { encodeSlices } from '../src/slices.ts'
import { turnCellOf } from '../src/turn.ts'

describe('BIRD_SLICES', () => {
  it('is the body carveBird makes; run `pnpm --filter @homingbird/sprites slices` after changing it', () => {
    const body = carveBird()
    expect(BIRD_SLICES).toEqual(encodeSlices(body, turnCellOf(body)))
  })

  it('stays small enough to ship in every web client', () => {
    expect(BIRD_SLICES.voxels.length).toBeLessThan(6000)
  })
})
