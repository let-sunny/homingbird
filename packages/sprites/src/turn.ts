import { rgbOf } from './color.ts'
import { COLORS } from './grid.ts'
import { type Palette, type Pixels, blank, hexOf } from './render.ts'
import { type Volume, voxelAt } from './volume.ts'

/**
 * A turning bird as one row of `TURN_DIRECTIONS` cells, facing the viewer first and turning a step
 * further in each cell. Every cell is `cell` cut out of the same frame, so the row plays as a turntable.
 */
export const turnSheet = (volume: Volume, cell: TurnCell, palette: Palette = {}): Pixels => {
  const sheet = blank(cell.width * TURN_DIRECTIONS, cell.height)
  for (let direction = 0; direction < TURN_DIRECTIONS; direction++) {
    const frame = renderTurn(volume, (360 * direction) / TURN_DIRECTIONS, palette)
    for (let row = 0; row < cell.height; row++) {
      const from = ((row + cell.top) * frame.width + cell.left) * 4
      sheet.data.set(
        frame.data.subarray(from, from + cell.width * 4),
        (row * sheet.width + direction * cell.width) * 4,
      )
    }
  }
  return sheet
}

/** The part of a frame every direction fits in, with a pixel to spare on each side. */
export interface TurnCell {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export const TURN_DIRECTIONS = 16

/** How long each direction shows: a whole turn takes a little over two seconds. */
export const TURN_DIRECTION_MS = 140

/** Measures the cell over all directions, so that every character drawn on the same body shares it. */
export const turnCellOf = (volume: Volume): TurnCell => {
  const [xs, ys]: [number[], number[]] = [[], []]
  for (let direction = 0; direction < TURN_DIRECTIONS; direction++) {
    const frame = renderTurn(volume, (360 * direction) / TURN_DIRECTIONS, {})
    for (let at = 3; at < frame.data.length; at += 4) {
      if (frame.data[at] === 0) continue
      xs.push(((at - 3) / 4) % frame.width)
      ys.push(Math.floor((at - 3) / 4 / frame.width))
    }
  }
  const [left, top] = [Math.min(...xs) - 1, Math.min(...ys) - 1]
  return { left, top, width: Math.max(...xs) + 2 - left, height: Math.max(...ys) + 2 - top }
}

/**
 * One frame: each slice from the ground up, turned by `degrees`, squashed for a view from above, lifted a
 * little more than the one below, and drawn over it. One ink outline goes around the whole stack.
 */
export const renderTurn = (volume: Volume, degrees: number, palette: Palette): Pixels => {
  const { width, length, height } = volume
  const diagonal = Math.ceil(Math.hypot(width, length)) + 8
  const frame = blank(diagonal + 12, Math.ceil(diagonal * SQUASH) + Math.ceil((height - 1) * SPACING) + 16)
  const centreX = Math.floor(frame.width / 2)
  const ground = frame.height - Math.ceil((diagonal * SQUASH) / 2) - 6
  const radians = degrees * (Math.PI / 180)
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
  const body = blank(frame.width, frame.height)
  const colorOf = colorsFor(volume, palette)
  for (let z = 0; z < height; z++) {
    const base = ground - Math.round(z * SPACING)
    for (let y = 0; y < frame.height; y++) {
      const dy = (y - base) / SQUASH
      for (let x = 0; x < frame.width; x++) {
        const dx = x - centreX
        const column = Math.floor(dx * cos + dy * sin + width / 2)
        const row = Math.floor(-dx * sin + dy * cos + length / 2)
        if (column < 0 || column >= width || row < 0 || row >= length) continue
        const voxel = voxelAt(volume, z, row, column)
        if (voxel !== null) body.data.set(colorOf(voxel.color, voxel.shaded, z), (y * frame.width + x) * 4)
      }
    }
  }
  outline(frame, body)
  return frame
}

const SQUASH = 0.8
const SPACING = 0.88
const SHADE = 0.15

/** Shaded voxels are darker toward the ground. */
const colorsFor = (volume: Volume, palette: Palette) => {
  const known = new Map<string, readonly number[]>()
  return (color: string, shaded: boolean, z: number): readonly number[] => {
    const key = `${color} ${shaded ? z : -1}`
    const found = known.get(key)
    if (found !== undefined) return found
    const factor = shaded ? 1 - SHADE * (1 - z / Math.max(volume.height - 1, 1)) - SHADE * 0.4 : 1
    const made = [...rgbOf(hexOf(color, palette)).map((channel) => Math.trunc(channel * factor)), 255]
    known.set(key, made)
    return made
  }
}

const outline = (frame: Pixels, body: Pixels): void => {
  const ink = [...rgbOf(COLORS.K), 255]
  const isSolid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < body.width && y < body.height && body.data[(y * body.width + x) * 4 + 3]! > 0
  for (let y = 0; y < body.height; y++)
    for (let x = 0; x < body.width; x++) {
      const at = (y * body.width + x) * 4
      if (isSolid(x, y)) frame.data.set(body.data.subarray(at, at + 4), at)
      else if (isSolid(x - 1, y) || isSolid(x + 1, y) || isSolid(x, y - 1) || isSolid(x, y + 1))
        frame.data.set(ink, at)
    }
}
