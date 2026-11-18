import { type Schema, isOk } from '@homingbird/kernel'
import { CharacterSpec, type PaletteKey } from './character-spec.ts'
import { contrast, distance } from './color.ts'
import { COLORS, GRID } from './grid.ts'
import { BODY } from './pip-parts.ts'

/**
 * Checks a character against the brand rules and returns what to fix, in words a person or a model can
 * act on. An empty list means the character may be used. Clients call it for feedback; Dovecote calls it
 * again before saving.
 */
export const validateCharacter = (input: unknown): string[] => {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const decoded = CharacterSpec.decode(input)
  const issues = isOk(decoded) ? [] : decoded.error
  const problems = [...headerProblems(raw, issues), ...nameProblems(raw)]

  const paletteProblems = paletteProblemsOf(raw, issues)
  if (paletteProblems.length > 0) return [...problems, ...paletteProblems]
  const palette = paletteOf(raw)
  if (isCopyOfPip(palette) && raw.id !== 'pigeon') problems.push(COPY_OF_PIP)

  const marks = Array.isArray(raw.marks) ? (raw.marks as unknown[]) : []
  const markProblems = marks.flatMap(markProblem)
  if (markProblems.length > 0) return [...problems, ...markProblems]
  const others = otherProblems(issues)
  if (others.length > 0) return [...problems, ...others]

  return [...problems, ...drawingProblems(marks as CharacterSpec['marks'], raw.noFeet === true, palette)]
}

export const LIMITS = {
  nameMax: 20,
  colorsMax: 8,
  markCellsMax: 80,
  outsideCellsMax: 16,
  edgeSpikesMax: 10,
  eyeContrastMin: 3,
  systemDistanceMin: 60,
  systemContrastMin: 1.25,
  visibleShareMin: 0.5,
  visibleContrast: 1.25,
} as const

/** Cells, as `x,y` keys, where markings may sit outside the body. */
export const ZONES = {
  iconCorner: () => outsideBody(region(12, 15, 0, 4)),
  headTop: () => outsideBody(region(2, 11, 0, 2)),
  tail: () => outsideBody(region(0, 2, 11, 15)),
  under: () => outsideBody(region(3, 13, 13, 15)),
  mouth: () => region(11, 15, 8, 11),
} as const

const headerProblems = (raw: Record<string, unknown>, issues: ReadonlyArray<Schema.Issue>): string[] => {
  const at = (field: string) => issues.some((issue) => issue.path[0] === field)
  return [
    ...(at('version') || at('base') ? ['version must be 1 and base must be "bubble-16"'] : []),
    ...(at('id') ? ['id: 2-32 chars of a-z, 0-9 and "-"'] : []),
    ...(at('name') || String(raw.name ?? '').trim() === '' ? [`name: 1-${LIMITS.nameMax} characters`] : []),
  ].filter((problem, index, all) => all.indexOf(problem) === index)
}

const nameProblems = (raw: Record<string, unknown>): string[] => {
  const name = String(raw.name ?? '').toLowerCase()
  return BANNED_NAME_WORDS.some((word) => name.includes(word))
    ? ['name: may not contain Claude, Anthropic, Homingbird or Pip']
    : []
}

const paletteProblemsOf = (raw: Record<string, unknown>, issues: ReadonlyArray<Schema.Issue>): string[] => {
  const given = typeof raw.palette === 'object' && raw.palette !== null ? raw.palette : {}
  return Object.keys(given).flatMap((key) => {
    if (!(PALETTE_KEYS as ReadonlyArray<string>).includes(key))
      return [`palette: unknown key '${key}' (allowed: B, D, O, F, K)`]
    const isBad = issues.some((issue) => issue.path[0] === 'palette' && issue.path[1] === key)
    return isBad ? [`palette.${key}: must be #RRGGBB`] : []
  })
}

const paletteOf = (raw: Record<string, unknown>): Record<PaletteKey, string> => {
  const given = (raw.palette ?? {}) as Partial<Record<PaletteKey, string>>
  return Object.fromEntries(
    PALETTE_KEYS.map((key) => [key, (given[key] ?? PIP_PALETTE[key]).toUpperCase()]),
  ) as Record<PaletteKey, string>
}

const isCopyOfPip = (palette: Record<PaletteKey, string>): boolean =>
  (['B', 'D', 'O'] as const).every((key) => palette[key] === PIP_PALETTE[key])

const markProblem = (mark: unknown, index: number): string[] => {
  if (!Array.isArray(mark) || mark.length !== 5 || !mark.slice(0, 4).every(Number.isInteger))
    return [`marks[${index}]: must be [x, y, w, h, color] with whole numbers`]
  const [x, y, w, h, color] = mark as [number, number, number, number, unknown]
  if (w < 1 || h < 1 || x < 0 || y < 0 || x + w > GRID || y + h > GRID)
    return [`marks[${index}]: must sit inside the 16x16 grid`]
  if (!(PALETTE_KEYS as ReadonlyArray<unknown>).includes(color) && !HEX.test(String(color)))
    return [`marks[${index}]: color must be #RRGGBB or one of B, D, O, F, K`]
  return []
}

const otherProblems = (issues: ReadonlyArray<Schema.Issue>): string[] =>
  issues
    .filter((issue) => !['version', 'base', 'id', 'name', 'palette'].includes(String(issue.path[0])))
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))

const drawingProblems = (
  marks: CharacterSpec['marks'],
  hasNoFeet: boolean,
  palette: Record<PaletteKey, string>,
): string[] => {
  const problems: string[] = []
  const colorOf = new Map<string, string>()
  for (const [x, y, w, h, color] of marks)
    for (const cell of cellsOf(x, y, w, h))
      colorOf.set(cell, (color in palette ? palette[color as PaletteKey] : color).toUpperCase())

  const marked = new Set(colorOf.keys())
  const outside = [...marked].filter((cell) => !SILHOUETTE.has(cell))
  const zones = {
    iconCorner: ZONES.iconCorner(),
    headTop: ZONES.headTop(),
    tail: ZONES.tail(),
    under: ZONES.under(),
    mouth: ZONES.mouth(),
  }
  if (marked.size > LIMITS.markCellsMax)
    problems.push(`marks cover ${marked.size} cells; the limit is ${LIMITS.markCellsMax}`)
  if (outside.length > LIMITS.outsideCellsMax)
    problems.push(`${outside.length} mark cells sit outside the body; the limit is ${LIMITS.outsideCellsMax}`)
  if (outside.some((cell) => zones.iconCorner.has(cell)))
    problems.push(
      'marks may not go in the top-right corner outside the body (x 12-15, y 0-4): status icons appear there',
    )
  if ([...marked].some((cell) => zones.mouth.has(cell)))
    problems.push('marks may not go below the beak (x 11-15, y 8-11): characters have no mouths')
  if (outside.some((cell) => zones.under.has(cell)) && !hasNoFeet)
    problems.push('marks under the body need "noFeet": true (they would clash with the feet)')
  problems.push(...strayProblems(outside, zones, hasNoFeet))

  const finished = finishedCells(colorOf, palette, hasNoFeet)
  problems.push(...colorProblems(finished, palette))
  return problems
}

const strayProblems = (
  outside: ReadonlyArray<string>,
  zones: Readonly<Record<'iconCorner' | 'headTop' | 'tail' | 'under', ReadonlySet<string>>>,
  hasNoFeet: boolean,
): string[] => {
  const allowed = (cell: string) =>
    zones.headTop.has(cell) || zones.tail.has(cell) || (hasNoFeet && zones.under.has(cell))
  const stray = outside.filter((cell) => !allowed(cell) && !zones.iconCorner.has(cell))
  if (stray.length === 0) return []
  const touching = new Set(
    [...SILHOUETTE].flatMap((cell) => {
      const [x, y] = xyOf(cell)
      return NEIGHBOURS.map(([dx, dy]) => keyOf(x + dx, y + dy))
    }),
  )
  const far = stray
    .filter((cell) => !touching.has(cell))
    .map(xyOf)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  return [
    ...(far.length > 0
      ? [
          `marks outside the body must touch the outline or sit in the ears/tail/under zones: [${far
            .slice(0, 4)
            .map(([x, y]) => `(${x}, ${y})`)
            .join(', ')}]`,
        ]
      : []),
    ...(stray.length > LIMITS.edgeSpikesMax
      ? [`${stray.length} spike cells along the outline; the limit is ${LIMITS.edgeSpikesMax}`]
      : []),
  ]
}

const finishedCells = (
  colorOf: ReadonlyMap<string, string>,
  palette: Record<PaletteKey, string>,
  hasNoFeet: boolean,
): Map<string, string> => {
  const finished = new Map<string, string>()
  for (const cell of SILHOUETTE) finished.set(cell, BEAK.has(cell) ? palette.O : palette.B)
  for (const [cell, color] of colorOf) finished.set(cell, color)
  if (!hasNoFeet) for (const cell of FEET_CELLS) finished.set(cell, palette.F)
  return finished
}

const colorProblems = (
  finished: ReadonlyMap<string, string>,
  palette: Record<PaletteKey, string>,
): string[] => {
  const problems: string[] = []
  const colors = new Set([...finished.values(), palette.K, palette.D])
  if (colors.size > LIMITS.colorsMax) problems.push(`${colors.size} colors; the limit is ${LIMITS.colorsMax}`)
  for (const [system, what] of SYSTEM_COLORS)
    if (
      distance(palette.B, system) < LIMITS.systemDistanceMin &&
      contrast(palette.B, system) < LIMITS.systemContrastMin
    )
      problems.push(
        `palette.B ${palette.B} is too close to the ${what} color ${system}; it would vanish on the body`,
      )
  const dimEye = EYE_CELLS.find(
    ([x, y]) => contrast(palette.K, finished.get(keyOf(x, y)) ?? palette.B) < LIMITS.eyeContrastMin,
  )
  if (dimEye !== undefined) {
    const behind = finished.get(keyOf(...dimEye)) ?? palette.B
    problems.push(
      `eye ${palette.K} needs ${LIMITS.eyeContrastMin.toFixed(1)}:1 contrast with ${behind} behind it at (${dimEye[0]}, ${dimEye[1]})`,
    )
  }
  const outline = [...finished.keys()].filter((cell) => {
    const [x, y] = xyOf(cell)
    return NEIGHBOURS.some(([dx, dy]) => !finished.has(keyOf(x + dx, y + dy)))
  })
  for (const [name, ground] of GROUNDS) {
    const visible = outline.filter(
      (cell) => contrast(finished.get(cell)!, ground) >= LIMITS.visibleContrast,
    ).length
    if (visible < LIMITS.visibleShareMin * outline.length)
      problems.push(
        `too faint on ${name} ${ground}: only ${visible}/${outline.length} outline cells stand out`,
      )
  }
  return problems
}

const keyOf = (x: number, y: number): string => `${x},${y}`
const xyOf = (cell: string): [number, number] => cell.split(',').map(Number) as [number, number]

function cellsOf(x: number, y: number, w: number, h: number): string[] {
  return Array.from({ length: w * h }, (_, i) => keyOf(x + (i % w), y + Math.floor(i / w)))
}

function region(x0: number, x1: number, y0: number, y1: number): Set<string> {
  return new Set(cellsOf(x0, y0, x1 - x0 + 1, y1 - y0 + 1))
}

function outsideBody(cells: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...cells].filter((cell) => !SILHOUETTE.has(cell)))
}

const SILHOUETTE: ReadonlySet<string> = new Set(BODY.flatMap(([x, y, w, h]) => cellsOf(x, y, w, h)))
const BEAK: ReadonlySet<string> = new Set([keyOf(14, 6), keyOf(15, 6), keyOf(14, 7)])
const FEET_CELLS = [keyOf(6, 13), keyOf(6, 14), keyOf(9, 13), keyOf(9, 14)]
const EYE_CELLS: ReadonlyArray<[number, number]> = [
  [10, 4],
  [10, 6],
  [11, 5],
  [11, 6],
  [12, 4],
  [12, 6],
]
const NEIGHBOURS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]
const GROUNDS: ReadonlyArray<readonly [string, string]> = [
  ['Mist', '#F2F5FA'],
  ['Night', '#22324E'],
]
const SYSTEM_COLORS: ReadonlyArray<readonly [string, string]> = [
  ['#FFD879', 'envelope'],
  ['#F25F5C', 'alert badge'],
  ['#3FBFA6', 'sparkle'],
]
const PALETTE_KEYS: ReadonlyArray<PaletteKey> = ['B', 'D', 'O', 'F', 'K']
const PIP_PALETTE: Record<PaletteKey, string> = {
  B: COLORS.B,
  D: COLORS.D,
  O: COLORS.O,
  F: COLORS.F,
  K: COLORS.K,
}
const BANNED_NAME_WORDS = ['claude', 'anthropic', 'homingbird', 'pip']
const HEX = /^#[0-9A-Fa-f]{6}$/
const COPY_OF_PIP = 'palette: B, D and O all match Pip; Pip is the brand, make it your own'
