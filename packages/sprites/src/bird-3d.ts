import { birdViews } from './bird-model.ts'
import { BIRD_SLICES } from './bird-slices.ts'
import { carveViews } from './carve.ts'
import type { CharacterSpec } from './character-spec.ts'
import { dressBird, paintFlanks } from './flank-decals.ts'
import type { Pixels } from './render.ts'
import { decodeSlices } from './slices.ts'
import { TAIL_REACH, addTail } from './tail.ts'
import { turnSheet } from './turn.ts'
import type { Volume } from './volume.ts'

/**
 * A character's 16-direction turn sheet, built from the shared slices: its markings on the flanks, its
 * palette on every voxel. Pip is the pigeon, with no palette and no markings.
 */
export const birdTurnSheet = (spec: Pick<CharacterSpec, 'palette' | 'marks' | 'noFeet'>): Pixels =>
  turnSheet(dressBird(sharedBody(), spec), BIRD_SLICES.cell, { ...spec.palette })

/** The carved body every character shares, with its tail, and Pip's wing patches and eyes painted on its flanks. */
export const carveBird = (): Volume => {
  const carved = addTail(carveViews(birdViews(), BODY_HEIGHT))
  const winged = paintFlanks(carved, 3, (row, z) => {
    const reach = wingReach(row, z)
    if (reach <= 1) return { color: 'D', shaded: reach > WING_EDGE }
    return reach <= WING_LIGHT && z > WING.z ? { color: 'B', shaded: false } : null
  })
  return paintFlanks(winged, 3, (row, z) => (isEye(row, z) ? { color: 'K', shaded: false } : null))
}

export const BODY_HEIGHT = 26

let decoded: Volume | null = null

const sharedBody = (): Volume => {
  decoded ??= decodeSlices(BIRD_SLICES)
  return decoded
}

/** How far out on the wing patch a point is: 0 at its middle, 1 at its edge. */
const wingReach = (row: number, z: number): number =>
  ((row - WING.row) / WING.length) ** 2 + ((z - WING.z) / WING.height) ** 2

const WING = { row: 12 + TAIL_REACH, z: 11, length: 9, height: 5 } as const

/**
 * The wing's rim is shaded and a band of lit body runs over it, so the wing stands out from the shaded
 * flank even at 1×.
 */
const WING_EDGE = 0.45
const WING_LIGHT = 1.6

const isEye = (row: number, z: number): boolean => Math.abs(row - EYE_ROW) <= 1.5 && Math.abs(z - 17) <= 1.5

const EYE_ROW = 20.5 + TAIL_REACH
