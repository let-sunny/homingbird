import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { iconPixels, iconSvg, markPixels, markSvg } from '../brand-art.ts'
import type { CharacterSpec } from '../character-spec.ts'
import { statesFor } from '../dress.ts'
import type { Frame } from '../grid.ts'
import { PRESETS } from '../presets.ts'
import { type Palette, renderFrame, renderSheet, sheetLayout } from '../render.ts'
import { STATES, STATE_PURPOSE } from '../states.ts'
import { encodeGif } from './gif.ts'
import { encodeIco } from './ico.ts'
import { encodePng } from './png.ts'

/** Writes every generated asset under `root`: `brand/`, `pip/` and `characters/`. */
export const buildAssets = (root: string): void => {
  buildBrand(join(root, 'brand'))
  buildPip(join(root, 'pip'))
  buildCharacters(join(root, 'characters'))
}

export const buildBrand = (directory: string): void => {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'homingbird-mark.svg'), markSvg())
  writeFileSync(join(directory, 'homingbird-icon.svg'), iconSvg())
  for (const size of [64, 128, 256, 512])
    writeFileSync(join(directory, `homingbird-mark-${size}.png`), encodePng(markPixels(size)))
  for (const size of [180, 192, 512, 1024])
    writeFileSync(join(directory, `homingbird-icon-${size}.png`), encodePng(iconPixels(size)))
  for (const size of [16, 32, 48])
    writeFileSync(join(directory, `favicon-${size}.png`), encodePng(markPixels(size)))
  writeFileSync(join(directory, 'favicon.ico'), encodeIco([16, 32, 48].map(markPixels)))
}

export const buildPip = (directory: string): void => {
  writeSet(directory, 'pip', STATES, {}, true)
  const layout = sheetLayout(STATES)
  const states = Object.fromEntries(
    Object.entries(layout).map(([name, frames]) => [
      name,
      { about: STATE_PURPOSE[name as keyof typeof STATE_PURPOSE], frames },
    ]),
  )
  writeFileSync(
    join(directory, 'pip-sheet.json'),
    `${JSON.stringify({ cell: { w: 16, h: 17 }, states }, null, 2)}\n`,
  )
}

/** Character sheets only; GIFs per character are made on demand with `homingbird-sprites gif`. */
export const buildCharacters = (
  directory: string,
  characters: ReadonlyArray<CharacterSpec> = PRESETS,
): void => {
  for (const character of characters)
    writeSet(
      join(directory, character.id),
      character.id,
      statesFor(character),
      { ...character.palette },
      false,
    )
  const index = { cell: { w: 16, h: 17 }, states: STATE_PURPOSE, layout: sheetLayout(STATES), characters }
  writeFileSync(join(directory, 'characters.json'), `${JSON.stringify(index, null, 2)}\n`)
}

export const gifOf = (frames: ReadonlyArray<Frame>, scale: number, palette: Palette = {}): Buffer =>
  encodeGif(frames.map((frame) => ({ pixels: renderFrame(frame, scale, palette), ms: frame.ms })))

const writeSet = (
  directory: string,
  prefix: string,
  states: Readonly<Record<string, ReadonlyArray<Frame>>>,
  palette: Palette,
  withGifs: boolean,
): void => {
  mkdirSync(directory, { recursive: true })
  for (const scale of [1, 8])
    writeFileSync(
      join(directory, `${prefix}-sheet@${scale}x.png`),
      encodePng(renderSheet(states, scale, palette)),
    )
  if (!withGifs) return
  for (const [name, frames] of Object.entries(states))
    writeFileSync(join(directory, `${prefix}-${name}.gif`), gifOf(frames, 8, palette))
}
