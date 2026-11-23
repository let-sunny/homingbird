/** What the generated turn sheet says about itself in `assets/pip/pip-turn.json`. */
export interface TurnSheet {
  readonly cell: { readonly w: number; readonly h: number }
  readonly directions: number
  readonly ms: number
}

/**
 * The rules that turn a bird: one row of cells stepped through with `steps()`, Pip's sheet from
 * `pipUrl`, any other from `--turn-sheet`, and the front held still for reduced motion.
 */
export const turnStylesheet = (sheet: TurnSheet, pipUrl: string): string => {
  const { w, h } = sheet.cell
  const row = w * sheet.directions
  return [
    '.turning-bird {',
    '  --turn-scale: 2;',
    '  display: inline-block;',
    '  flex: none;',
    `  inline-size: calc(${w}px * var(--turn-scale));`,
    `  block-size: calc(${h}px * var(--turn-scale));`,
    '  background-image: var(--turn-sheet);',
    '  background-repeat: no-repeat;',
    `  background-size: calc(${row}px * var(--turn-scale)) calc(${h}px * var(--turn-scale));`,
    '  image-rendering: pixelated;',
    `  animation: bird-turn var(--hb-duration-bird-turn) steps(${sheet.directions}) infinite;`,
    '}',
    `.turning-bird.is-pip { --turn-sheet: url("${pipUrl}"); }`,
    ...SCALES.map((scale) => `.turn-x${scale} { --turn-scale: ${scale}; }`),
    '@keyframes bird-turn {',
    '  from { background-position: 0 0; }',
    `  to { background-position: calc(-${row}px * var(--turn-scale)) 0; }`,
    '}',
    '@media (prefers-reduced-motion: reduce) { .turning-bird { animation: none; background-position: 0 0; } }',
    '',
  ].join('\n')
}

const SCALES = [1, 2, 3] as const
