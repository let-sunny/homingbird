import type { View, Views } from './carve.ts'

/**
 * Pip's body from above, from the side, from the front and from behind, each cropped to the bird: a round
 * body, a tail tuft, wing tips just proud of the flanks, a short wedge of a beak and two feet. Eyes and the
 * wing patch are painted on after carving, so they are not here.
 */
export const birdViews = (): Views => {
  const model = birdModel()
  return {
    top: crop(
      look(LENGTH, WIDTH, (row, column) => scan(HEIGHT, (step) => model(row, column, HEIGHT - 1 - step))),
    ),
    side: crop(
      look(HEIGHT, LENGTH, (row, column) =>
        scan(WIDTH, (step) => model(column, WIDTH - 1 - step, HEIGHT - 1 - row)),
      ),
    ),
    front: crop(
      look(HEIGHT, WIDTH, (row, column) =>
        scan(LENGTH, (step) => model(LENGTH - 1 - step, column, HEIGHT - 1 - row)),
      ),
    ),
    back: crop(
      look(HEIGHT, WIDTH, (row, column) =>
        scan(LENGTH, (step) => model(step, WIDTH - 1 - column, HEIGHT - 1 - row)),
      ),
    ),
  }
}

/** The palette key of the voxel at each point of the model grid, or null for air. */
const birdModel = (): ((x: number, y: number, z: number) => string | null) => {
  const keys: Array<string | null> = Array.from({ length: LENGTH * WIDTH * HEIGHT }, () => null)
  for (let x = 0; x < LENGTH; x++)
    for (let y = 0; y < WIDTH; y++)
      for (let z = 0; z < HEIGHT; z++) keys[(x * WIDTH + y) * HEIGHT + z] = keyAt(x + 0.5, y + 0.5, z + 0.5)
  return (x, y, z) => keys[(x * WIDTH + y) * HEIGHT + z] ?? null
}

const LENGTH = 32
const WIDTH = 24
const HEIGHT = 26
const MIDDLE = WIDTH / 2

/** Later parts paint over earlier ones, as in a drawing. */
const keyAt = (x: number, y: number, z: number): string | null => {
  const isBody = ellipsoid(x, y, z, [14, MIDDLE, 13.2], [11.5, 11.5, 11])
  let key: string | null = isBody ? 'B' : null
  if (!isBody && ellipsoid(x, y, z, [2.4, MIDDLE, 14.8], [3.6, 3, 4.4])) key = 'D'
  if (!isBody && ellipsoid(x, y, z, [5, MIDDLE, 11], [4.2, 3.4, 3.2])) key = 'B'
  if (ellipsoid(x, y, z, [8, MIDDLE, 12], [7.5, 12.3, 3.2]) && Math.abs(y - MIDDLE) > 10.9 && x < 14)
    key = 'D'
  if (
    x >= 23.5 &&
    x < 31 &&
    Math.sqrt((y - MIDDLE) ** 2 + ((z - 13.4) * 1.45) ** 2) <= (3.4 * (31 - x)) / 7.5 + 0.6
  )
    key = 'O'
  for (const side of [-1, 1]) {
    const isOverFoot = Math.abs(y - (MIDDLE + side * 4)) < 1.1
    if (isOverFoot && x > 12 && x < 15 && z < 4.2) key = 'F'
    if (isOverFoot && x > 12 && x < 18 && z < 1.6) key = 'F'
  }
  return key
}

const ellipsoid = (
  x: number,
  y: number,
  z: number,
  [cx, cy, cz]: readonly [number, number, number],
  [rx, ry, rz]: readonly [number, number, number],
): boolean => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1

const look = (height: number, width: number, at: (row: number, column: number) => string | null): View => ({
  width,
  height,
  keys: Array.from({ length: width * height }, (_, index) => at(Math.floor(index / width), index % width)),
})

/** The first solid voxel met along a line of sight. */
const scan = (steps: number, at: (step: number) => string | null): string | null => {
  for (let step = 0; step < steps; step++) {
    const key = at(step)
    if (key !== null) return key
  }
  return null
}

const crop = (view: View): View => {
  const rows: number[] = []
  const columns: number[] = []
  view.keys.forEach((key, index) => {
    if (key === null) return
    rows.push(Math.floor(index / view.width))
    columns.push(index % view.width)
  })
  const [top, left] = [Math.min(...rows), Math.min(...columns)]
  const [height, width] = [Math.max(...rows) - top + 1, Math.max(...columns) - left + 1]
  return look(height, width, (row, column) => view.keys[(row + top) * view.width + column + left] ?? null)
}
