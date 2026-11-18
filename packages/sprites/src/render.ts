import { rgbOf } from './color.ts'
import { CELL_H, COLORS, type Frame, GRID, type Rect } from './grid.ts'

/** RGBA pixels, row by row, transparent wherever nothing is drawn. */
export interface Pixels {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

export type Palette = Readonly<Partial<Record<string, string>>>

/** Draws one frame at a whole-number scale into a 16×17 cell image. */
export const renderFrame = (frame: Frame, scale: number, palette: Palette = {}): Pixels =>
  rasterize(frame.rects, scale, frame.bob, palette)

/** A sprite sheet: one row per state, one 16×17 cell per frame. */
export const renderSheet = (
  states: Readonly<Record<string, ReadonlyArray<Frame>>>,
  scale: number,
  palette: Palette = {},
): Pixels => {
  const rows = Object.values(states)
  const columns = Math.max(...rows.map((frames) => frames.length))
  const sheet = blank(GRID * scale * columns, CELL_H * scale * rows.length)
  rows.forEach((frames, row) => {
    frames.forEach((frame, column) => {
      paste(sheet, renderFrame(frame, scale, palette), GRID * scale * column, CELL_H * scale * row)
    })
  })
  return sheet
}

/** Where each frame of a `renderSheet` sheet sits at 1×, and how long it shows. */
export const sheetLayout = (states: Readonly<Record<string, ReadonlyArray<Frame>>>) =>
  Object.fromEntries(
    Object.entries(states).map(([name, frames], row) => [
      name,
      frames.map((frame, column) => ({
        x: GRID * column,
        y: CELL_H * row,
        w: GRID,
        h: CELL_H,
        ms: frame.ms,
      })),
    ]),
  )

export const rasterize = (
  rects: ReadonlyArray<Rect>,
  scale: number,
  bob = 0,
  palette: Palette = {},
): Pixels => {
  const image = blank(GRID * scale, CELL_H * scale)
  for (const [x, y, w, h, color] of rects) {
    const [r, g, b] = rgbOf(hexOf(color, palette))
    const top = Math.max(0, roundHalfEven((y + bob) * scale))
    const bottom = Math.min(image.height, roundHalfEven((y + bob + h) * scale))
    const left = Math.max(0, roundHalfEven(x * scale))
    const right = Math.min(image.width, roundHalfEven((x + w) * scale))
    for (let row = top; row < bottom; row++)
      for (let column = left; column < right; column++)
        image.data.set([r, g, b, 255], (row * image.width + column) * 4)
  }
  return image
}

export const blank = (width: number, height: number): Pixels => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
})

/** Copies the opaque pixels of `source` into `target` at (`left`, `top`). */
export const paste = (target: Pixels, source: Pixels, left: number, top: number): void => {
  for (let row = 0; row < source.height; row++)
    for (let column = 0; column < source.width; column++) {
      const from = (row * source.width + column) * 4
      const x = column + left
      const y = row + top
      if (source.data[from + 3] === 0 || x < 0 || y < 0 || x >= target.width || y >= target.height) continue
      target.data.set(source.data.subarray(from, from + 4), (y * target.width + x) * 4)
    }
}

export const hexOf = (color: string, palette: Palette = {}): string => {
  if (color.startsWith('#')) return color
  const hex = palette[color] ?? (COLORS as Readonly<Record<string, string>>)[color]
  if (hex === undefined) throw new Error(`unknown sprite color ${color}`)
  return hex
}

/** Rounds halves to the even neighbour, so cell edges land on the same pixels as the reference art. */
export const roundHalfEven = (value: number): number => {
  const rounded = Math.round(value)
  return Math.abs(value % 1) === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded
}
