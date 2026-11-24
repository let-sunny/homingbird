import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TURN_DIRECTIONS, TURN_DIRECTION_MS } from '@homingbird/sprites'
import { describe, expect, it } from 'vitest'
import { turnStylesheet } from '../src/turn-stylesheet.ts'

describe('turnStylesheet', () => {
  const css = turnStylesheet()

  it('steps through the 16 directions of one row of 39-pixel cells, pixelated', () => {
    expect(css).toContain('inline-size: calc(39px * var(--turn-scale))')
    expect(css).toContain('background-size: calc(624px * var(--turn-scale)) calc(39px * var(--turn-scale))')
    expect(css).toContain('animation: bird-turn var(--hb-duration-bird-turn) steps(16) infinite')
    expect(css).toContain('to { background-position: calc(-624px * var(--turn-scale)) 0; }')
    expect(css).toContain('image-rendering: pixelated')
    expect(css).toContain('background-image: var(--turn-sheet)')
  })

  it('shows the 3D bird and hides the flat sprite by default', () => {
    expect(css).toContain('.character-turn .turn-still { display: none; }')
  })

  it('swaps the 3D bird for the flat sprite when reduced motion is asked for', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.character-turn .turning-bird { display: none; }')
    expect(reduced).toContain('.character-turn .turn-still { display: inline-block; }')
  })

  it('turns once in the time the duration token gives, as many directions as the sheet has', () => {
    const tokens = readFileSync(join(import.meta.dirname, '..', 'src', 'styles', 'tokens.css'), 'utf8')
    expect(tokens).toContain(`--hb-duration-bird-turn: ${TURN_DIRECTIONS * TURN_DIRECTION_MS}ms;`)
  })
})
