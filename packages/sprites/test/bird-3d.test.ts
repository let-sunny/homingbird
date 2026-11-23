import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BODY_HEIGHT, birdTurnSheet, carveBird } from '../src/bird-3d.ts'
import { decodePng } from '../src/node/png.ts'
import { PRESETS } from '../src/presets.ts'
import { expectSamePixels } from './same-pixels.ts'

describe('bird-3d', () => {
  it('turns Pip exactly like the reference sheet', () => {
    const reference = decodePng(readFileSync(new URL('./golden/pip-turn@1x.png', import.meta.url)))
    expectSamePixels(birdTurnSheet({ palette: {}, marks: [] }), reference)
  })

  it('carves a body as tall as asked, with eyes and wings painted on', () => {
    const body = carveBird()
    expect(body.height).toBe(BODY_HEIGHT)
    const colors = new Set(body.cells.map((voxel) => voxel?.color))
    expect(colors).toEqual(new Set([undefined, 'B', 'D', 'O', 'F', 'K']))
  })

  it('draws the pigeon as Pip, and every other character on the same body in its own colors', () => {
    const pip = birdTurnSheet({ palette: {}, marks: [] })
    expect(birdTurnSheet(PRESETS[0]!).data).toEqual(pip.data)
    const fox = birdTurnSheet(PRESETS.find((preset) => preset.id === 'fox')!)
    expect([fox.width, fox.height]).toEqual([pip.width, pip.height])
    expect(fox.data).not.toEqual(pip.data)
  })
})
