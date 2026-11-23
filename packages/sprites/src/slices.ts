import type { TurnCell } from './turn.ts'
import type { Volume, Voxel } from './volume.ts'

/**
 * A carved body as a short string: one letter per voxel, its palette key, lower case when shaded, `.`
 * for air, and a count after a letter that repeats. Slices go bottom first, rows tail first.
 */
export interface BirdSlices {
  readonly width: number
  readonly length: number
  readonly height: number
  readonly cell: TurnCell
  readonly voxels: string
}

export const encodeSlices = (volume: Volume, cell: TurnCell): BirdSlices => {
  const letters = volume.cells.map(letterOf)
  let voxels = ''
  for (let at = 0; at < letters.length; ) {
    let run = 1
    while (letters[at + run] === letters[at]) run++
    voxels += `${letters[at]}${run > 1 ? run : ''}`
    at += run
  }
  return { width: volume.width, length: volume.length, height: volume.height, cell, voxels }
}

export const decodeSlices = (slices: BirdSlices): Volume => {
  const cells: Array<Voxel | null> = []
  for (const [, letter, count] of slices.voxels.matchAll(/([.A-Za-z])(\d*)/g)) {
    const voxel =
      letter === '.' ? null : { color: letter!.toUpperCase(), shaded: letter !== letter!.toUpperCase() }
    for (let made = 0; made < (count === '' ? 1 : Number(count)); made++) cells.push(voxel)
  }
  return { width: slices.width, length: slices.length, height: slices.height, cells }
}

/** The TypeScript module that ships the slices to every client, written by `homingbird-sprites slices`. */
export const slicesModule = (slices: BirdSlices): string =>
  [
    "import type { BirdSlices } from './slices.ts'",
    '',
    "/** Pip's carved body, written by `pnpm --filter @homingbird/sprites slices`; a test keeps it current. */",
    `export const BIRD_SLICES: BirdSlices = ${JSON.stringify(slices)}`,
    '',
  ].join('\n')

const letterOf = (voxel: Voxel | null): string => {
  if (voxel === null) return '.'
  if (!/^[A-Z]$/.test(voxel.color))
    throw new Error(`the shared body holds palette keys only, not ${voxel.color}`)
  return voxel.shaded ? voxel.color.toLowerCase() : voxel.color
}
