import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCREENSHOT_VARIABLES, SUITES, parseShard, shardOf, suiteFilesIn, suitesRunBy } from '../web-e2e.ts'

const e2eFolder = join(import.meta.dirname, '..', '..', 'packages', 'pwa', 'e2e')

const namesOf = (suites: ReadonlyArray<{ readonly name: string }>): string[] =>
  suites.map((suite) => suite.name).sort()

describe('the web client end-to-end runner', () => {
  it('runs every suite file in the e2e folder, so none goes stale unnoticed', () => {
    expect(namesOf(SUITES)).toEqual(suiteFilesIn(e2eFolder).sort())
  })

  it('runs the same suites as the e2e script of the web client, and the demo sweeps besides', () => {
    const manifest = JSON.parse(readFileSync(join(e2eFolder, '..', 'package.json'), 'utf8')) as {
      scripts: { e2e: string }
    }
    expect(suitesRunBy(manifest.scripts.e2e).sort()).toEqual(
      namesOf(SUITES.filter((suite) => suite.needs === 'pwa')),
    )
    expect(namesOf(SUITES.filter((suite) => suite.needs === 'demo'))).toEqual(['demo-sweep', 'phone-popups'])
  })

  it('chooses the screenshot folder of every suite through a variable the runner sets', () => {
    const used = readdirSync(e2eFolder)
      .filter((file) => file.endsWith('.e2e.ts') && file !== 'readme-screenshots.e2e.ts')
      .flatMap((file) => readFileSync(join(e2eFolder, file), 'utf8').match(/HB_E2E_[A-Z_]+/g) ?? [])
    expect(used.filter((name) => !SCREENSHOT_VARIABLES.includes(name))).toEqual([])
  })

  it('puts every suite in exactly one shard and keeps the shards about as long as each other', () => {
    const slowest = Math.max(...SUITES.map((suite) => suite.seconds))
    for (const count of [1, 2, 3, 4]) {
      const shards = Array.from({ length: count }, (_, index) => shardOf(SUITES, index + 1, count))
      expect(namesOf(shards.flat())).toEqual(namesOf(SUITES))
      const loads = shards.map((shard) => shard.reduce((sum, suite) => sum + suite.seconds, 0))
      expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(slowest)
    }
  })

  it('reads a shard as its place of a count, and nothing else', () => {
    expect(parseShard('2/3')).toEqual({ index: 2, count: 3 })
    for (const text of ['0/3', '4/3', 'x', '2', '2/3/4', '']) expect(parseShard(text)).toBeNull()
  })

  it('finds the suites a pnpm script runs, in order', () => {
    expect(suitesRunBy('tsx build.ts && tsx e2e/a-b.e2e.ts && tsx e2e/c.e2e.ts')).toEqual(['a-b', 'c'])
  })
})
