import { GRID, type Rect } from './grid.ts'
import { type Pixels, blank, hexOf, paste, rasterize } from './render.ts'
import { STATES } from './states.ts'

/** The Homingbird mark: Pip's first idle frame. It never animates and always wears Pip's own colors. */
export const MARK: ReadonlyArray<Rect> = STATES.idle[0]!.rects

export const ICON_TILE = { color: '#22324E', cells: 22, left: 3, top: 2, radius: 5 } as const

export const markSvg = (): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" shape-rendering="crispEdges">${rectsSvg(MARK, 0, 0)}</svg>\n`

export const iconSvg = (): string => {
  const tile = ICON_TILE
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tile.cells} ${tile.cells}" shape-rendering="crispEdges">` +
    `<rect width="${tile.cells}" height="${tile.cells}" rx="${tile.radius}" fill="${tile.color}" shape-rendering="geometricPrecision"/>` +
    `${rectsSvg(MARK, tile.left, tile.top)}</svg>\n`
  )
}

/** The mark at any pixel size: drawn at the next whole-number scale up, then shrunk once. */
export const markPixels = (size: number): Pixels => {
  const scale = Math.max(1, Math.ceil(size / GRID))
  const drawn = crop(rasterize(MARK, scale), GRID * scale)
  return drawn.width === size ? drawn : downscale(drawn, size)
}

/** The app icon: Pip on a rounded Night tile. */
export const iconPixels = (size: number): Pixels => {
  const tile = ICON_TILE
  const scale = Math.ceil(size / tile.cells)
  const side = tile.cells * scale
  const radius = tile.radius * scale
  const drawn = blank(side, side)
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(tile.color.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ]
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const nearestX = Math.min(Math.max(x + 0.5, radius), side - radius)
      const nearestY = Math.min(Math.max(y + 0.5, radius), side - radius)
      if ((x + 0.5 - nearestX) ** 2 + (y + 0.5 - nearestY) ** 2 <= radius ** 2)
        drawn.data.set([r, g, b, 255], (y * side + x) * 4)
    }
  paste(drawn, crop(rasterize(MARK, scale), GRID * scale), tile.left * scale, tile.top * scale)
  return drawn.width === size ? drawn : downscale(drawn, size)
}

/** Area-average shrink to a square, weighting color by alpha. */
export const downscale = (image: Pixels, size: number): Pixels => {
  const shrunk = blank(size, size)
  const step = image.width / size
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let [r, g, b, a, count] = [0, 0, 0, 0, 0]
      for (let sy = Math.floor(y * step); sy < Math.ceil((y + 1) * step); sy++)
        for (let sx = Math.floor(x * step); sx < Math.ceil((x + 1) * step); sx++) {
          const at = (sy * image.width + sx) * 4
          const alpha = image.data[at + 3]!
          r += image.data[at]! * alpha
          g += image.data[at + 1]! * alpha
          b += image.data[at + 2]! * alpha
          a += alpha
          count++
        }
      const to = (y * size + x) * 4
      if (a > 0) shrunk.data.set([r / a, g / a, b / a], to)
      shrunk.data[to + 3] = a / count
    }
  return shrunk
}

const crop = (image: Pixels, side: number): Pixels => {
  const cropped = blank(side, side)
  for (let y = 0; y < side; y++)
    cropped.data.set(image.data.subarray(y * image.width * 4, (y * image.width + side) * 4), y * side * 4)
  return cropped
}

const rectsSvg = (rects: ReadonlyArray<Rect>, left: number, top: number): string =>
  rects
    .map(
      ([x, y, w, h, color]) =>
        `<rect x="${x + left}" y="${y + top}" width="${w}" height="${h}" fill="${hexOf(color)}"/>`,
    )
    .join('')
