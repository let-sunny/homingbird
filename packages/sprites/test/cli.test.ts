import { describe, expect, it } from 'vitest'
import { type CliIo, runCli } from '../src/cli.ts'
import { PRESETS } from '../src/presets.ts'

const fakeIo = (files: Record<string, string> = {}) => {
  const out: string[] = []
  const err: string[] = []
  const written: Record<string, Uint8Array> = {}
  const built: string[] = []
  const io: CliIo = {
    readText: (path) => files[path] ?? '',
    writeFile: (path, data) => {
      written[path] = data
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    buildAssets: (directory) => built.push(directory),
    encodePng: (pixels) => new Uint8Array([pixels.width]),
    encodeGif: (frames) => new Uint8Array([frames.length]),
  }
  return { io, out, err, written, built }
}

const fox = JSON.stringify(PRESETS.find((character) => character.id === 'fox'))

describe('homingbird-sprites', () => {
  it('checks a character and says it passes', () => {
    const run = fakeIo({ 'fox.json': fox })
    expect(runCli(['check', 'fox.json'], run.io)).toBe(0)
    expect(run.out).toEqual(['ok: the character passes every rule'])
  })

  it('lists every problem and exits 1 when a character breaks the rules', () => {
    const run = fakeIo({ 'bad.json': '{"version":1}' })
    expect(runCli(['check', 'bad.json'], run.io)).toBe(1)
    expect(run.err[0]).toMatch(/problem/)
  })

  it('treats text that is not JSON as a broken character', () => {
    expect(runCli(['check', 'x'], fakeIo({ x: 'not json' }).io)).toBe(1)
  })

  it('writes a three-up preview and a GIF for one state', () => {
    const run = fakeIo({ 'fox.json': fox })
    expect(runCli(['preview', 'fox.json', 'fox.png', '--scale', '2'], run.io)).toBe(0)
    expect(run.written['fox.png']).toEqual(new Uint8Array([96]))
    expect(runCli(['gif', 'fox.json', 'sending', 'fox.gif'], run.io)).toBe(0)
    expect(run.written['fox.gif']).toEqual(new Uint8Array([4]))
  })

  it('refuses to preview or animate a broken character, and an unknown state', () => {
    const run = fakeIo({ 'fox.json': fox, 'bad.json': '{}' })
    expect(runCli(['preview', 'bad.json', 'x.png'], run.io)).toBe(1)
    expect(runCli(['gif', 'bad.json', 'idle', 'x.gif'], run.io)).toBe(1)
    expect(runCli(['gif', 'fox.json', 'dancing', 'x.gif'], run.io)).toBe(2)
  })

  it('prints a random character, the presets and the states', () => {
    const run = fakeIo()
    expect(runCli(['random', '7'], run.io)).toBe(0)
    expect(JSON.parse(run.out[0]!)).toMatchObject({ version: 1, base: 'bubble-16' })
    runCli(['presets'], run.io)
    runCli(['states'], run.io)
    expect(run.out.length).toBe(1 + 24 + 22)
  })

  it('builds assets into the directory it is given', () => {
    const run = fakeIo()
    expect(runCli(['build', 'out'], run.io)).toBe(0)
    expect(run.built).toEqual(['out'])
  })

  it('prints usage for anything else', () => {
    const run = fakeIo()
    expect(runCli(['dance'], run.io)).toBe(2)
    expect(run.err[0]).toMatch(/^usage:/)
  })
})
