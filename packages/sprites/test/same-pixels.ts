import { expect } from 'vitest'
import type { Pixels } from '../src/render.ts'

export const expectSamePixels = (actual: Pixels, expected: Pixels): void => {
  expect([actual.width, actual.height]).toEqual([expected.width, expected.height])
  for (let at = 0; at < actual.data.length; at += 4) {
    const shown = actual.data.subarray(at, at + 4)
    const wanted = expected.data.subarray(at, at + 4)
    if (shown[3] === 0 && wanted[3] === 0) continue
    const pixel = at / 4
    expect([...shown], `pixel (${pixel % actual.width}, ${Math.floor(pixel / actual.width)})`).toEqual([
      ...wanted,
    ])
  }
}
