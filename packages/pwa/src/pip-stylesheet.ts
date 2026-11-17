export interface PipSheet {
  readonly cell: { readonly w: number; readonly h: number }
  readonly states: Readonly<Record<string, { readonly frames: ReadonlyArray<PipFrame> }>>
}

export interface PipFrame {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly ms: number
}

export const pipStylesheet = (sheet: PipSheet, imageUrl: string): string =>
  [
    baseRule(sheet, imageUrl),
    ...Object.entries(sheet.states).flatMap(([state, { frames }]) => [...stateRules(state, frames)]),
    '@media (prefers-reduced-motion: reduce) { .pip { animation: none; } }',
    '',
  ].join('\n')

export const sheetSize = (sheet: PipSheet): { readonly width: number; readonly height: number } => {
  const frames = Object.values(sheet.states).flatMap((state) => state.frames)
  return {
    width: Math.max(...frames.map((frame) => frame.x + frame.w)),
    height: Math.max(...frames.map((frame) => frame.y + frame.h)),
  }
}

const baseRule = (sheet: PipSheet, imageUrl: string): string => {
  const { width, height } = sheetSize(sheet)
  return [
    '.pip {',
    '  --pip-scale: 2;',
    '  display: inline-block;',
    '  flex: none;',
    `  inline-size: calc(${sheet.cell.w}px * var(--pip-scale));`,
    `  block-size: calc(${sheet.cell.h}px * var(--pip-scale));`,
    `  background-image: url("${imageUrl}");`,
    '  background-repeat: no-repeat;',
    `  background-size: calc(${width}px * var(--pip-scale)) calc(${height}px * var(--pip-scale));`,
    '  image-rendering: pixelated;',
    '}',
  ].join('\n')
}

function* stateRules(state: string, frames: ReadonlyArray<PipFrame>): Generator<string, void> {
  const first = frames[0]
  if (first === undefined) return
  const total = frames.reduce((sum, frame) => sum + frame.ms, 0)
  yield `.pip.is-${state} { background-position: ${positionOf(first)}; animation: pip-${state} ${total}ms step-end infinite; }`
  let elapsed = 0
  const stops: string[] = []
  for (const frame of frames) {
    stops.push(`  ${percent(elapsed, total)} { background-position: ${positionOf(frame)}; }`)
    elapsed += frame.ms
  }
  yield `@keyframes pip-${state} {\n${stops.join('\n')}\n}`
}

const positionOf = (frame: PipFrame): string =>
  `calc(${-frame.x}px * var(--pip-scale)) calc(${-frame.y}px * var(--pip-scale))`

const percent = (elapsed: number, total: number): string => `${Number(((elapsed / total) * 100).toFixed(3))}%`
