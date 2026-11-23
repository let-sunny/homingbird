import { roundHalfEven } from './render.ts'
import { type Volume, type Voxel, cellIndex } from './volume.ts'

/**
 * Carves four orthographic views into slices, `height` of them: a cell is solid where every view sees
 * something along its line, each row is rounded to the ellipse its side and front spans describe, and
 * each voxel takes its color from the view that faces it. Edges near a step down are shaded.
 */
export const carveViews = (views: Views, height: number): Volume => {
  const length = roundHalfEven((height * views.side.width) / views.side.height)
  const width = roundHalfEven((length * views.top.width) / views.top.height)
  const top = fit(views.top, width, length)
  const side = fit(views.side, length, height)
  const front = fit(views.front, width, height)
  const back = mirror(fit(views.back, width, height))
  const solid = Array.from({ length: height }, (_, z) => solidSlice(top, side, front, back, height - 1 - z))
  const cells: Array<Voxel | null> = Array.from({ length: width * length * height }, () => null)
  const size = { width, length }
  const covered = Array.from({ length: length * width }, () => false)
  for (let z = height - 1; z >= 0; z--) {
    const viewRow = height - 1 - z
    const above = [...covered]
    const slice = solid[z]!
    slice.forEach((isSolid, at) => {
      if (isSolid) covered[at] = true
    })
    const nearAbove = grow(above, length, width, NEAR_ABOVE)
    for (let row = 0; row < length; row++)
      for (let column = 0; column < width; column++) {
        const at = row * width + column
        if (!slice[at]) continue
        const { face, depth } = nearestEdge(slice, length, width, row, column)
        const isSteepStep = !above[at] && depth <= 2 && nearAbove[at]!
        const overhead = z + 1 < height ? (cells[cellIndex(size, z + 1, row, column)] ?? null) : null
        const topKey = top.keys[at]!
        cells[cellIndex(size, z, row, column)] =
          !above[at] && !isSteepStep
            ? { color: topKey, shaded: false }
            : above[at] && depth > 2 && overhead !== null
              ? overhead
              : {
                  color: edgeKey(face, row, column, { side, front, back }, viewRow) ?? topKey,
                  shaded: depth <= 2,
                }
      }
  }
  return { width, length, height, cells }
}

/** A picture of palette keys, row by row; null where nothing is drawn. */
export interface View {
  readonly width: number
  readonly height: number
  readonly keys: ReadonlyArray<string | null>
}

/** The side view has the front at the right; the back view is as seen from behind. */
export interface Views {
  readonly top: View
  readonly side: View
  readonly front: View
  readonly back: View
}

/** Nearest-neighbour resampling that picks the source pixel under each target pixel's centre. */
export const fit = (view: View, width: number, height: number): View => ({
  width,
  height,
  keys: Array.from({ length: width * height }, (_, index) => {
    const row = Math.floor(((Math.floor(index / width) + 0.5) * view.height) / height)
    const column = Math.floor((((index % width) + 0.5) * view.width) / width)
    return view.keys[row * view.width + column] ?? null
  }),
})

const NEAR_ABOVE = 2

const solidSlice = (top: View, side: View, front: View, back: View, viewRow: number): boolean[] => {
  const length = top.height
  const width = top.width
  const along = Array.from({ length }, (_, x) => side.keys[viewRow * side.width + x] !== null)
  const across = Array.from(
    { length: width },
    (_, y) => front.keys[viewRow * width + y] !== null || back.keys[viewRow * width + y] !== null,
  )
  const lathe = latheOf(along, across)
  return Array.from({ length: length * width }, (_, at) => {
    const row = Math.floor(at / width)
    const column = at % width
    return top.keys[at] !== null && along[row]! && across[column]! && (lathe === null || lathe(row, column))
  })
}

/** The ellipse a row is clipped to; null when a span has a gap, as between two feet, which stay square. */
const latheOf = (
  along: ReadonlyArray<boolean>,
  across: ReadonlyArray<boolean>,
): ((row: number, column: number) => boolean) | null => {
  const rows = spanOf(along)
  const columns = spanOf(across)
  if (rows === null || columns === null) return null
  const [rowRadius, columnRadius] = [(rows[1] - rows[0]) / 2 + 0.5, (columns[1] - columns[0]) / 2 + 0.5]
  const [rowCentre, columnCentre] = [(rows[0] + rows[1]) / 2, (columns[0] + columns[1]) / 2]
  return (row, column) =>
    ((row - rowCentre) / rowRadius) ** 2 + ((column - columnCentre) / columnRadius) ** 2 < 1
}

const spanOf = (line: ReadonlyArray<boolean>): readonly [number, number] | null => {
  const first = line.indexOf(true)
  const last = line.lastIndexOf(true)
  if (first < 0) return null
  return line.slice(first, last + 1).every(Boolean) ? [first, last] : null
}

/** Cells to the nearest empty cell or the slice's edge, toward each side; the first nearest names the face. */
const nearestEdge = (
  slice: ReadonlyArray<boolean>,
  length: number,
  width: number,
  row: number,
  column: number,
): { readonly face: number; readonly depth: number } => {
  const isSolid = (r: number, c: number): boolean =>
    r >= 0 && r < length && c >= 0 && c < width && slice[r * width + c]!
  const reach = (dr: number, dc: number): number => {
    let steps = 0
    while (isSolid(row + dr * steps, column + dc * steps)) steps++
    return steps
  }
  const distances = [reach(0, -1), reach(0, 1), reach(-1, 0), reach(1, 0)]
  const depth = Math.min(...distances)
  return { face: distances.indexOf(depth), depth }
}

/** Faces 0 and 1 look out of a flank, 2 toward the tail, 3 toward the beak. */
const edgeKey = (
  face: number,
  row: number,
  column: number,
  views: Pick<Views, 'side' | 'front' | 'back'>,
  viewRow: number,
): string | null => {
  if (face < 2) return clampedKey(views.side, viewRow, row)
  return clampedKey(face === 2 ? views.back : views.front, viewRow, column)
}

/** The view's key at a column, held to the drawn span of that row so that every edge finds a color. */
const clampedKey = (view: View, row: number, column: number): string | null => {
  const line = view.keys.slice(row * view.width, (row + 1) * view.width)
  const first = line.findIndex((key) => key !== null)
  if (first < 0) return null
  const last = line.findLastIndex((key) => key !== null)
  return line[Math.min(Math.max(column, first), last)] ?? null
}

const grow = (mask: ReadonlyArray<boolean>, length: number, width: number, by: number): boolean[] =>
  mask.map((_, at) => {
    const row = Math.floor(at / width)
    const column = at % width
    for (let r = Math.max(0, row - by); r <= Math.min(length - 1, row + by); r++)
      for (let c = Math.max(0, column - by); c <= Math.min(width - 1, column + by); c++)
        if (mask[r * width + c]) return true
    return false
  })

const mirror = (view: View): View => ({
  ...view,
  keys: view.keys.map((_, index) => {
    const row = Math.floor(index / view.width)
    return view.keys[row * view.width + view.width - 1 - (index % view.width)] ?? null
  }),
})
