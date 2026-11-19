import type { CharacterSpec } from './character-spec.ts'
import { statesFor } from './dress.ts'
import { composeCharacter } from './editor.ts'
import type { Frame } from './grid.ts'
import { PRESETS } from './presets.ts'
import { randomCharacter } from './random-character.ts'
import { blank, paste, renderFrame } from './render.ts'
import type { Pixels } from './render.ts'
import { validateCharacter } from './rules.ts'
import { STATE_NAMES, STATE_PURPOSE, type StateName } from './states.ts'

/**
 * The `homingbird-sprites` command. `check` and `preview` never save anything: they let a person or an
 * agent try a character before a person decides to use it. Returns the exit code.
 */
export const runCli = (args: ReadonlyArray<string>, io: CliIo): number => {
  const [command, ...rest] = args
  const [first, second, third] = rest
  if (command === 'build' && first !== undefined) {
    io.buildAssets(first)
    io.out(`wrote assets to ${first}`)
    return 0
  }
  if (command === 'check' && first !== undefined) {
    const problems = validateCharacter(parse(io.readText(first)))
    if (problems.length > 0) return reportProblems(problems, io)
    io.out('ok: the character passes every rule')
    return 0
  }
  if (command === 'preview' && first !== undefined && second !== undefined) {
    const spec = parse(io.readText(first)) as CharacterSpec
    const problems = validateCharacter(spec)
    if (problems.length > 0) return reportProblems(problems, io)
    io.writeFile(second, io.encodePng(previewOf(spec, Number(rest[rest.indexOf('--scale') + 1] ?? 8) || 8)))
    io.out(`wrote ${second}: idle, sending, new note`)
    return 0
  }
  if (command === 'gif' && first !== undefined && second !== undefined && third !== undefined) {
    const spec = parse(io.readText(first)) as CharacterSpec
    const problems = validateCharacter(spec)
    if (problems.length > 0) return reportProblems(problems, io)
    if (!(STATE_NAMES as ReadonlyArray<string>).includes(second)) {
      io.err(`unknown state ${second}; see homingbird-sprites states`)
      return 2
    }
    io.writeFile(third, io.encodeGif(statesFor(spec)[second as StateName], { ...spec.palette }))
    io.out(`wrote ${third}`)
    return 0
  }
  if (command === 'random' && first !== undefined && Number.isInteger(Number(first))) {
    io.out(JSON.stringify(composeCharacter(randomCharacter(Number(first))), null, 2))
    return 0
  }
  if (command === 'presets') {
    for (const preset of PRESETS)
      io.out(`${preset.id.padEnd(12)} ${preset.name}${preset.noFeet ? ' (no feet)' : ''}`)
    return 0
  }
  if (command === 'states') {
    for (const state of STATE_NAMES) io.out(`${state.padEnd(18)} ${STATE_PURPOSE[state]}`)
    return 0
  }
  io.err(USAGE)
  return 2
}

export interface CliIo {
  readonly readText: (path: string) => string
  readonly writeFile: (path: string, data: Uint8Array) => void
  readonly out: (line: string) => void
  readonly err: (line: string) => void
  readonly buildAssets: (directory: string) => void
  readonly encodePng: (pixels: Pixels) => Uint8Array
  readonly encodeGif: (frames: ReadonlyArray<Frame>, palette: Readonly<Record<string, string>>) => Uint8Array
}

/** Idle, sending and new note side by side: the three a person needs to judge a character. */
const previewOf = (spec: CharacterSpec, scale: number): Pixels => {
  const states = statesFor(spec)
  const shown: ReadonlyArray<readonly [StateName, number]> = [
    ['idle', 0],
    ['sending', 1],
    ['new-note', 1],
  ]
  const cell = renderFrame(states.idle[0]!, scale)
  const preview = blank(cell.width * shown.length, cell.height)
  shown.forEach(([state, index], column) => {
    paste(preview, renderFrame(states[state][index]!, scale, { ...spec.palette }), cell.width * column, 0)
  })
  return preview
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const reportProblems = (problems: ReadonlyArray<string>, io: CliIo): number => {
  io.err(`${problems.length} problem(s):`)
  for (const problem of problems) io.err(`  - ${problem}`)
  return 1
}

const USAGE = `usage:
  homingbird-sprites build <dir>
  homingbird-sprites check <spec.json | ->
  homingbird-sprites preview <spec.json | -> <out.png> [--scale N]
  homingbird-sprites gif <spec.json | -> <state> <out.gif>
  homingbird-sprites random <seed>
  homingbird-sprites presets
  homingbird-sprites states`
