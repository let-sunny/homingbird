import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildAssets, buildCharacterGifs, buildCharacters, gifOf } from '../../src/node/build-assets.ts'
import { PRESETS } from '../../src/presets.ts'
import { STATES } from '../../src/states.ts'

const root = mkdtempSync(join(tmpdir(), 'homingbird-sprites-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('buildAssets', () => {
  it('writes the brand, Pip and the characters', () => {
    buildAssets(root)
    for (const file of [
      'brand/favicon.ico',
      'brand/homingbird-icon-1024.png',
      'pip/pip-sending.gif',
      'pip/pip-sheet.json',
      'characters/fox/fox-sheet@8x.png',
      'characters/gif/fox.gif',
    ])
      expect(existsSync(join(root, file)), file).toBe(true)
    const sheet = JSON.parse(readFileSync(join(root, 'pip/pip-sheet.json'), 'utf8'))
    expect(Object.keys(sheet.states)).toHaveLength(22)
  }, 60_000)

  it('indexes the characters it was given', () => {
    buildCharacters(join(root, 'two'), PRESETS.slice(0, 2))
    const index = JSON.parse(readFileSync(join(root, 'two/characters.json'), 'utf8'))
    expect(index.characters.map((character: { id: string }) => character.id)).toEqual(['pigeon', 'cat'])
  })

  it('animates each character at 6x', () => {
    buildCharacterGifs(join(root, 'gifs'), PRESETS.slice(0, 3))
    const size = (file: string) => {
      const gif = readFileSync(join(root, 'gifs', file))
      return [gif.readUInt16LE(6), gif.readUInt16LE(8)]
    }
    expect(size('cat.gif')).toEqual([96, 102])
  })

  it('makes a GIF of any state', () => {
    expect(gifOf(STATES.idle, 1).subarray(0, 3).toString('ascii')).toBe('GIF')
  })
})
