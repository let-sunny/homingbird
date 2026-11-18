import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../src/node/png.ts'
import { renderSheet } from '../src/render.ts'
import { STATES, STATE_NAMES, STATE_PURPOSE } from '../src/states.ts'
import { expectSamePixels } from './same-pixels.ts'

describe('states', () => {
  it('draws Pip exactly like the reference sheet', () => {
    const reference = decodePng(readFileSync(new URL('./golden/pip-sheet@1x.png', import.meta.url)))
    expectSamePixels(renderSheet(STATES, 1), reference)
  })

  it('says what each of the 22 states is for', () => {
    expect(STATE_NAMES).toHaveLength(22)
    for (const state of STATE_NAMES) expect(STATE_PURPOSE[state].length).toBeGreaterThan(10)
  })

  it('never shows a frame for no time', () => {
    for (const frames of Object.values(STATES))
      for (const frame of frames) expect(frame.ms).toBeGreaterThanOrEqual(140)
  })
})
