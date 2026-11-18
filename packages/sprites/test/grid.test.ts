import { describe, expect, it } from 'vitest'
import { CELL_H, COLORS, GRID } from '../src/grid.ts'

describe('grid', () => {
  it('leaves one row under the 16-cell grid for the bob', () => {
    expect(CELL_H).toBe(GRID + 1)
  })

  it('names every sprite color as #RRGGBB', () => {
    for (const hex of Object.values(COLORS)) expect(hex).toMatch(/^#[0-9A-F]{6}$/)
  })
})
