import { describe, expect, it } from 'vitest'
import { birdViews } from '../src/bird-model.ts'
import type { View } from '../src/carve.ts'

const keyAt = (view: View, row: number, column: number) => view.keys[row * view.width + column]

const silhouette = (view: View) => view.keys.map((key) => key !== null)

describe('birdViews', () => {
  const views = birdViews()

  it('crops each view to the bird', () => {
    expect([views.top.width, views.top.height]).toEqual([24, 31])
    expect([views.side.width, views.side.height]).toEqual([31, 24])
    expect([views.front.width, views.front.height]).toEqual([24, 24])
    expect([views.back.width, views.back.height]).toEqual([24, 24])
  })

  it('draws the body, the wedge of a beak at the front and the feet at the bottom', () => {
    const front = Array.from({ length: views.side.height }, (_, row) =>
      keyAt(views.side, row, views.side.width - 1),
    )
    expect(new Set(front)).toEqual(new Set([null, 'O']))
    expect(keyAt(views.side, 12, 10)).toBe('B')
    expect(views.side.keys.slice(-views.side.width)).toContain('F')
  })

  it('shows the tail tuft from above and the wing tips beside the body', () => {
    expect(views.top.keys.slice(0, views.top.width)).toContain('D')
    expect(views.front.keys).toContain('D')
  })

  it('is the same bird seen from the front and from behind, mirrored', () => {
    const mirrored = views.back.keys.map((_, at) => {
      const row = Math.floor(at / views.back.width)
      return views.back.keys[row * views.back.width + views.back.width - 1 - (at % views.back.width)] !== null
    })
    expect(silhouette(views.front)).toEqual(mirrored)
  })
})
