import { BIRD_SLICES, TURN_DIRECTIONS } from '@homingbird/sprites'

/**
 * The rules that turn a bird in the character editor: one row of cells, drawn by the page and handed over
 * as `--turn-sheet`, stepped through with `steps()`. With reduced motion the 3D bird is hidden and the
 * flat sprite beside it shows instead.
 */
export const turnStylesheet = (): string => {
  const { width, height } = BIRD_SLICES.cell
  const row = width * TURN_DIRECTIONS
  return [
    '.turning-bird {',
    '  --turn-scale: 2;',
    '  display: inline-block;',
    '  flex: none;',
    `  inline-size: calc(${width}px * var(--turn-scale));`,
    `  block-size: calc(${height}px * var(--turn-scale));`,
    '  background-image: var(--turn-sheet);',
    '  background-repeat: no-repeat;',
    `  background-size: calc(${row}px * var(--turn-scale)) calc(${height}px * var(--turn-scale));`,
    '  image-rendering: pixelated;',
    `  animation: bird-turn var(--hb-duration-bird-turn) steps(${TURN_DIRECTIONS}) infinite;`,
    '}',
    '.character-turn .turn-still { display: none; }',
    '@keyframes bird-turn {',
    '  from { background-position: 0 0; }',
    `  to { background-position: calc(-${row}px * var(--turn-scale)) 0; }`,
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  .character-turn .turning-bird { display: none; }',
    '  .character-turn .turn-still { display: inline-block; }',
    '}',
    '',
  ].join('\n')
}
