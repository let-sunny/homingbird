import { describe, expect, it } from 'vitest'
import { dress, statesFor } from '../src/dress.ts'
import type { Rect } from '../src/grid.ts'
import { BODY, FEET } from '../src/pip-parts.ts'
import { presetById } from '../src/presets.ts'

describe('dress', () => {
  const mark: Rect = [5, 0, 1, 2, '#000000']

  it('draws markings right after the body, so eyes and icons stay on top', () => {
    const dressed = dress([...BODY, ...FEET], [mark], false, false)
    expect(dressed.indexOf(mark)).toBe(BODY.length)
  })

  it('drops the feet of a character without feet', () => {
    expect(dress([...BODY, ...FEET], [], false, true).some((rect) => rect[4] === 'F')).toBe(false)
  })

  it('mirrors markings when the frame is mirrored', () => {
    const dressed = dress([[14, 14, 2, 1, 'B']], [mark], true, false)
    expect(dressed[1]).toEqual([10, 0, 1, 2, '#000000'])
  })

  it('gives every character all 22 states', () => {
    expect(Object.keys(statesFor(presetById('cat')!))).toHaveLength(22)
  })
})
