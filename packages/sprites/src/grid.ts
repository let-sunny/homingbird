export const GRID = 16

/** Frame cells are one row taller than the grid so a frame can bob down by one cell. */
export const CELL_H = 17

export const COLORS = {
  B: '#8DA4CB',
  D: '#6D86B0',
  K: '#1B2333',
  O: '#F4A259',
  F: '#F4A259',
  A: '#F4A259',
  G: '#9AA9BF',
  M: '#5C6A80',
  T: '#3FBFA6',
  R: '#F25F5C',
  W: '#FFFFFF',
  Y: '#FFD879',
  V: '#E9B04A',
  N: '#B9772A',
  L: '#EAF6FF',
} as const

export type ColorKey = keyof typeof COLORS

/** `[x, y, w, h, color]` in cells; `color` is a palette key or `#RRGGBB`. */
export type Rect = readonly [number, number, number, number, string]

export interface Frame {
  readonly rects: ReadonlyArray<Rect>
  readonly ms: number
  readonly bob: number
}
