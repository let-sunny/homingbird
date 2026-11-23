import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type TurnSheet, turnStylesheet } from '../src/turn-stylesheet.ts'

const assets = join(import.meta.dirname, '..', '..', '..', 'assets', 'pip')
const shipped = JSON.parse(readFileSync(join(assets, 'pip-turn.json'), 'utf8')) as TurnSheet

describe('turnStylesheet', () => {
  const css = turnStylesheet(shipped, '/pip/pip-turn.png')

  it('steps through the 16 directions of one row of 39-pixel cells, pixelated', () => {
    expect(css).toContain('inline-size: calc(39px * var(--turn-scale))')
    expect(css).toContain('background-size: calc(624px * var(--turn-scale)) calc(39px * var(--turn-scale))')
    expect(css).toContain('animation: bird-turn var(--hb-duration-bird-turn) steps(16) infinite')
    expect(css).toContain('to { background-position: calc(-624px * var(--turn-scale)) 0; }')
    expect(css).toContain('image-rendering: pixelated')
  })

  it("draws Pip from the brand's file and anyone else from the sheet the page drew", () => {
    expect(css).toContain('.turning-bird.is-pip { --turn-sheet: url("/pip/pip-turn.png"); }')
    expect(css).toContain('background-image: var(--turn-sheet)')
  })

  it('holds the front still for people who prefer reduced motion', () => {
    expect(css).toContain(
      '@media (prefers-reduced-motion: reduce) { .turning-bird { animation: none; background-position: 0 0; } }',
    )
  })

  it('has a scale class for each whole-number size', () => {
    for (const scale of [1, 2, 3]) expect(css).toContain(`.turn-x${scale} { --turn-scale: ${scale}; }`)
  })

  it('turns once in the time the duration token gives, as many directions as the sheet has', () => {
    const tokens = readFileSync(join(import.meta.dirname, '..', 'src', 'styles', 'tokens.css'), 'utf8')
    expect(tokens).toContain(`--hb-duration-bird-turn: ${shipped.directions * shipped.ms}ms;`)
  })
})
