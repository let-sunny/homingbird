import type { CharacterSpec } from './character-spec.ts'
import { TAIL_REACH } from './tail.ts'
import { type Volume, type Voxel, cellIndex } from './volume.ts'

/**
 * A character's turning body: its markings painted on both flanks where the side view puts them, and the
 * feet taken away for a character without feet. Colors stay palette keys until the body is drawn.
 */
export const dressBird = (volume: Volume, spec: Pick<CharacterSpec, 'marks' | 'noFeet'>): Volume => {
  const footless = spec.noFeet === true ? withoutFeet(volume) : volume
  return spec.marks.reduce(
    (dressed, [x, y, w, h, color]) =>
      paintFlanks(dressed, MARK_DEPTH, (row, z) => {
        const [gridX, gridY] = gridPointOf(row, z)
        return gridX >= x && gridX < x + w && gridY >= y && gridY < y + h ? { color, shaded: false } : null
      }),
    footless,
  )
}

/**
 * Paints the outermost `depth` solid voxels of each flank, wherever `paint` returns a voxel for that row
 * and height. A decal goes on after carving, so it covers the same voxels from every direction.
 */
export const paintFlanks = (
  volume: Volume,
  depth: number,
  paint: (row: number, z: number) => Voxel | null,
): Volume => {
  const cells = [...volume.cells]
  const middle = volume.width / 2
  for (let z = 0; z < volume.height; z++)
    for (let row = 0; row < volume.length; row++) {
      const voxel = paint(row, z)
      if (voxel === null) continue
      const solid = Array.from({ length: volume.width }, (_, column) => column).filter(
        (column) => volume.cells[cellIndex(volume, z, row, column)] !== null,
      )
      const flanks = [
        solid.filter((column) => column < middle),
        solid.filter((column) => column >= middle).reverse(),
      ]
      for (const flank of flanks)
        for (const column of flank.slice(0, depth)) cells[cellIndex(volume, z, row, column)] = voxel
    }
  return { ...volume, cells }
}

/**
 * Where a voxel's row and height fall on the 16-cell side view a character's markings are drawn on: the
 * body spans cells 1 to 14 across and 2 to 14 down there, heights 26 down to 2 here. All of the tail that
 * reaches out behind that is in cell 0, so that a marking on the flat tail covers its point here too.
 */
export const gridPointOf = (row: number, z: number): readonly [number, number] => [
  Math.max(
    0,
    ON_GRID.left +
      ((row + 0.5 - IN_VOLUME.tail) * (ON_GRID.right - ON_GRID.left)) / (IN_VOLUME.beak - IN_VOLUME.tail),
  ),
  ON_GRID.top +
    ((IN_VOLUME.crown - (z + 0.5)) * (ON_GRID.bottom - ON_GRID.top)) / (IN_VOLUME.crown - IN_VOLUME.ground),
]

const MARK_DEPTH = 2

const ON_GRID = { left: 1, right: 14, top: 2, bottom: 14 } as const

const IN_VOLUME = { tail: 2 + TAIL_REACH, beak: 27 + TAIL_REACH, ground: 2, crown: 26 } as const

const withoutFeet = (volume: Volume): Volume => ({
  ...volume,
  cells: volume.cells.map((voxel) => (voxel?.color === 'F' ? null : voxel)),
})
