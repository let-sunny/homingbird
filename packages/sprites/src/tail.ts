import { type Volume, type Voxel, cellIndex, voxelAt } from './volume.ts'

/**
 * The body with the brand's speech-bubble tail: steps of body color that leave the body's lower rear and
 * go down and back to a point, along the middle so that both flanks show the same tail. It goes on after
 * carving, which would round it away, only where there is air, and reaches `TAIL_REACH` rows behind it.
 */
export const addTail = (volume: Volume): Volume => {
  const longer = withRowsAround(volume)
  const cells = [...longer.cells]
  STEPS.forEach(([first, end], step) => {
    for (let row = first; row < end; row++)
      for (let layer = 0; layer < STEP_HEIGHT; layer++)
        for (let column = 0; column < longer.width; column++) {
          if (Math.abs(column + 0.5 - longer.width / 2) > halfWidthAt(row)) continue
          const isOpenAbove = layer === STEP_HEIGHT - 1 && row < (STEPS[step + 1]?.[0] ?? end)
          cells[cellIndex(longer, step * STEP_HEIGHT + layer, row, column)] ??= {
            color: 'B',
            shaded: !isOpenAbove,
          }
        }
  })
  return { ...longer, cells }
}

/** How many rows the tail's point reaches behind the body. */
export const TAIL_REACH = 3

/** As many empty rows in front as behind keep the body turning about its own middle. */
const withRowsAround = (volume: Volume): Volume => {
  const length = volume.length + 2 * TAIL_REACH
  const cells: Array<Voxel | null> = []
  for (let z = 0; z < volume.height; z++)
    for (let row = -TAIL_REACH; row < volume.length + TAIL_REACH; row++)
      for (let column = 0; column < volume.width; column++)
        cells.push(row < 0 || row >= volume.length ? null : voxelAt(volume, z, row, column))
  return { ...volume, length, cells }
}

/** The tail widens evenly from its point to where it leaves the body. */
const halfWidthAt = (row: number): number => 1 + 0.45 * row

/** The rows of each step of the tail, the lowest step and its point first. */
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, 4],
  [1, 8],
  [3, 10],
]

const STEP_HEIGHT = 2
