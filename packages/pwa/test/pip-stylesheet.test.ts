import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type PipSheet, pipStylesheet, sheetSize } from '../src/pip-stylesheet.ts'

const sheet: PipSheet = {
  cell: { w: 16, h: 17 },
  states: {
    idle: {
      frames: [
        { x: 0, y: 0, w: 16, h: 17, ms: 300 },
        { x: 16, y: 0, w: 16, h: 17, ms: 100 },
      ],
    },
    read: { frames: [{ x: 0, y: 17, w: 16, h: 17, ms: 500 }] },
    empty: { frames: [] },
  },
}

describe('pipStylesheet', () => {
  const css = pipStylesheet(sheet, '/pip/pip-sheet.png')

  it('draws Pip from the sheet, pixelated, at a whole-number scale', () => {
    expect(css).toContain('background-image: url("/pip/pip-sheet.png")')
    expect(css).toContain('image-rendering: pixelated')
    expect(css).toContain('inline-size: calc(16px * var(--pip-scale))')
    expect(css).toContain('background-size: calc(32px * var(--pip-scale)) calc(34px * var(--pip-scale))')
  })

  it('steps through the frames of a state in proportion to their durations', () => {
    expect(css).toContain('animation: pip-idle 400ms step-end infinite')
    expect(css).toContain(
      '0% { background-position: calc(0px * var(--pip-scale)) calc(0px * var(--pip-scale)); }',
    )
    expect(css).toContain(
      '75% { background-position: calc(-16px * var(--pip-scale)) calc(0px * var(--pip-scale)); }',
    )
  })

  it('writes no rule for a state without frames', () => {
    expect(css).not.toContain('is-empty')
  })

  it('stops the animation for people who prefer reduced motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .pip { animation: none; } }')
  })

  it('covers every state the client shows, from the shipped sheet', () => {
    const shipped = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', '..', 'assets', 'pip', 'pip-sheet.json'), 'utf8'),
    ) as PipSheet
    const shippedCss = pipStylesheet(shipped, '/pip/pip-sheet.png')
    const used = readFileSync(join(import.meta.dirname, '..', 'src', 'views', 'pip.ts'), 'utf8')
      .split('export type PipScale')[0]!
      .matchAll(/\| '([a-z-]+)'/g)
    for (const [, state] of used) expect(shippedCss).toContain(`.pip.is-${state} {`)
  })
})

describe('sheetSize', () => {
  it('is the extent of the furthest frame', () => {
    expect(sheetSize(sheet)).toEqual({ width: 32, height: 34 })
  })
})
