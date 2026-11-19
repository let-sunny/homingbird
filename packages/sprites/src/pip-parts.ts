import { type Frame, GRID, type Rect } from './grid.ts'

export const BODY: ReadonlyArray<Rect> = [
  [5, 2, 6, 1, 'B'],
  [3, 3, 10, 1, 'B'],
  [2, 4, 12, 1, 'B'],
  [1, 5, 13, 1, 'B'],
  [1, 6, 13, 1, 'B'],
  [14, 6, 2, 1, 'O'],
  [1, 7, 13, 1, 'B'],
  [14, 7, 1, 1, 'O'],
  [1, 8, 13, 1, 'B'],
  [1, 9, 13, 1, 'B'],
  [1, 10, 13, 1, 'B'],
  [2, 11, 12, 1, 'B'],
  [2, 12, 11, 1, 'B'],
  [1, 13, 2, 1, 'B'],
  [0, 14, 2, 1, 'B'],
]

/** Character markings are drawn right after this rectangle, the last one of the body. */
export const BODY_TAIL: Rect = [0, 14, 2, 1, 'B']

export const FEET: ReadonlyArray<Rect> = [
  [6, 13, 1, 2, 'F'],
  [9, 13, 1, 2, 'F'],
]
export const WINGS = {
  up: [
    [4, 0, 2, 1, 'D'],
    [4, 1, 3, 1, 'D'],
    [5, 2, 3, 1, 'D'],
    [6, 3, 2, 1, 'D'],
  ],
  mid: [
    [3, 7, 4, 1, 'D'],
    [4, 8, 4, 1, 'D'],
  ],
  down: [
    [4, 9, 4, 1, 'D'],
    [4, 10, 3, 1, 'D'],
    [5, 11, 2, 2, 'D'],
  ],
} as const satisfies Record<string, ReadonlyArray<Rect>>

export const EYE: ReadonlyArray<Rect> = [[11, 5, 1, 2, 'K']]
export const EYE_SHUT: ReadonlyArray<Rect> = [[10, 6, 2, 1, 'K']]
export const EYE_HAPPY: ReadonlyArray<Rect> = [
  [10, 6, 1, 1, 'K'],
  [11, 5, 1, 1, 'K'],
  [12, 6, 1, 1, 'K'],
]
export const EYE_SMALL: ReadonlyArray<Rect> = [[11, 6, 1, 1, 'K']]
export const EYE_X: ReadonlyArray<Rect> = [
  [10, 4, 1, 1, 'K'],
  [12, 4, 1, 1, 'K'],
  [11, 5, 1, 1, 'K'],
  [10, 6, 1, 1, 'K'],
  [12, 6, 1, 1, 'K'],
]

export const ENVELOPE: ReadonlyArray<Rect> = [
  [10, 8, 6, 4, 'Y'],
  [10, 11, 6, 1, 'V'],
  [10, 8, 1, 1, 'N'],
  [11, 9, 1, 1, 'N'],
  [12, 10, 2, 1, 'N'],
  [14, 9, 1, 1, 'N'],
  [15, 8, 1, 1, 'N'],
]

export const QUESTION: ReadonlyArray<Rect> = [
  [13, 0, 3, 1, 'A'],
  [15, 1, 1, 1, 'A'],
  [14, 2, 1, 1, 'A'],
  [14, 4, 1, 1, 'A'],
]
export const HEART: ReadonlyArray<Rect> = [
  [11, 0, 2, 1, 'R'],
  [14, 0, 2, 1, 'R'],
  [11, 1, 5, 1, 'R'],
  [12, 2, 3, 1, 'R'],
  [13, 3, 1, 1, 'R'],
]
export const HEART_SMALL: ReadonlyArray<Rect> = [
  [12, 1, 1, 1, 'R'],
  [14, 1, 1, 1, 'R'],
  [12, 2, 3, 1, 'R'],
  [13, 3, 1, 1, 'R'],
]
export const RED_X: ReadonlyArray<Rect> = [
  [12, 0, 4, 4, 'R'],
  ...Array.from({ length: 6 }, (_, i): Rect => [12.5 + i * 0.45, 0.5 + i * 0.45, 0.75, 0.75, 'W']),
  ...Array.from({ length: 6 }, (_, i): Rect => [14.75 - i * 0.45, 0.5 + i * 0.45, 0.75, 0.75, 'W']),
]
export const DO_NOT_DISTURB: ReadonlyArray<Rect> = [
  [12, 0, 4, 4, 'R'],
  [12.75, 1.5, 2.5, 1, 'W'],
]
export const MOON: ReadonlyArray<Rect> = [
  [13, 0, 2, 1, 'Y'],
  [12, 1, 1, 2, 'Y'],
  [13, 3, 2, 1, 'Y'],
]
export const KEY: ReadonlyArray<Rect> = [
  [11, 0, 3, 1, 'Y'],
  [11, 1, 1, 1, 'Y'],
  [13, 1, 1, 1, 'Y'],
  [11, 2, 3, 1, 'Y'],
  [14, 1, 2, 1, 'Y'],
  [15, 2, 1, 1, 'Y'],
]
export const LENS: ReadonlyArray<Rect> = [
  [11, 0, 3, 1, 'M'],
  [11, 1, 1, 1, 'M'],
  [13, 1, 1, 1, 'M'],
  [11, 2, 3, 1, 'M'],
  [14, 3, 1, 1, 'M'],
]
export const PUFF: ReadonlyArray<Rect> = [
  [10, 13, 1, 1, 'G'],
  [12, 12, 1, 1, 'G'],
  [14, 13, 1, 1, 'G'],
  [12, 14, 1, 1, 'G'],
]

export const STANDING: ReadonlyArray<Rect> = [...BODY, [3, 8, 4, 1, 'D'], [4, 9, 4, 1, 'D'], ...FEET]

export const badge = (y: number): Rect[] => [
  [12, y, 4, 4, 'R'],
  [13.5, y + 0.5, 1, 1.75, 'W'],
  [13.5, y + 2.75, 1, 0.75, 'W'],
]

export const sparkle = (size: 0 | 1 | 2): Rect[] => {
  if (size === 2)
    return [
      [13, 0, 1, 3, 'T'],
      [12, 1, 3, 1, 'T'],
    ]
  return size === 1 ? [[13, 1, 1, 1, 'T']] : []
}

export const thinkingDots = (count: number): Rect[] =>
  Array.from({ length: count }, (_, i): Rect => [6 + 2 * i, 0, 1, 1, 'M'])

export const sleepingZ = (x: number, y: number): Rect[] => [
  [x, y, 4, 1, 'M'],
  [x + 2, y + 1, 1, 1, 'M'],
  [x + 1, y + 2, 1, 1, 'M'],
  [x, y + 3, 4, 1, 'M'],
]

export const checkMark = (color: string): Rect[] => [
  [12, 2, 1, 1, color],
  [13, 3, 1, 1, color],
  [14, 2, 1, 1, color],
  [15, 1, 1, 1, color],
]

export const tear = (y: number): Rect[] => [[12, y, 1, 1, 'L']]

export const spinner = (step: number): Rect[] =>
  (
    [
      [12, 0],
      [14, 0],
      [14, 2],
      [12, 2],
    ] as const
  ).map(([x, y], k): Rect => [x, y, 1, 1, k === step ? 'M' : 'G'])

export const dizzyStars = (phase: 0 | 1): Rect[] =>
  (phase === 0
    ? ([
        [3, 0],
        [8, 1],
        [13, 0],
      ] as const)
    : ([
        [5, 1],
        [10, 0],
        [14, 2],
      ] as const)
  ).map(([x, y]): Rect => [x, y, 1, 1, 'Y'])

export const confetti = (phase: number): Rect[] =>
  (
    [
      [2, 0, 'R'],
      [6, 1, 'T'],
      [10, 0, 'Y'],
      [14, 1, 'A'],
      [4, 2, 'T'],
      [12, 3, 'R'],
    ] as const
  ).map(([x, y, color]): Rect => [x + (phase % 2), (y + phase * 2) % 5, 1, 1, color])

export const mirror = (rects: ReadonlyArray<Rect>): Rect[] =>
  rects.map(([x, y, w, h, color]): Rect => [GRID - x - w, y, w, h, color])

export const shift = (rects: ReadonlyArray<Rect>, dx: number, dy: number): Rect[] =>
  rects.map(([x, y, w, h, color]): Rect => [x + dx, y + dy, w, h, color])

export const frame = (rects: ReadonlyArray<Rect>, ms: number, bob = 0): Frame => ({ rects, ms, bob })

export const sendingFrames = (): Frame[] =>
  (['up', 'mid', 'down', 'mid'] as const).map((wing, i) =>
    frame([...TRAILS[wing], ...FLYING, ...EYE, ...WINGS[wing], ...ENVELOPE], 140, i === 1 || i === 2 ? 1 : 0),
  )

const FEET_TUCKED: ReadonlyArray<Rect> = [[7, 13, 2, 1, 'F']]

const TRAILS = {
  up: [
    [0, 3, 1, 1, 'G'],
    [0, 9, 2, 1, 'G'],
  ],
  mid: [
    [0, 5, 2, 1, 'G'],
    [0, 11, 1, 1, 'G'],
  ],
  down: [
    [0, 7, 1, 1, 'G'],
    [0, 3, 2, 1, 'G'],
  ],
} as const satisfies Record<keyof typeof WINGS, ReadonlyArray<Rect>>

const FLYING: ReadonlyArray<Rect> = [...BODY, ...FEET_TUCKED]
