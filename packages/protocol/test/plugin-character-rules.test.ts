import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { characterLink } from '../src/character-link.ts'
import { characterProblems } from '../src/character.ts'

// The Claude Code plugin may import only its own files, so it carries the character rules as one generated
// module. Run with HB_WRITE_PLUGIN_BUNDLES=1 to write it again after changing the rules.
const MODULE = new URL('../../plugin/hooks/character-rules.mjs', import.meta.url).pathname

const HEADER = '// Generated from packages/protocol by its plugin-character-rules test. Do not edit.\n'

const characterRulesModule = async (): Promise<string> => {
  const built = await build({
    stdin: {
      contents: [
        "export { characterProblems, CHOOSABLE_CHARACTERS } from './src/character.ts'",
        "export { characterLink } from './src/character-link.ts'",
      ].join('\n'),
      resolveDir: new URL('..', import.meta.url).pathname,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    write: false,
  })
  return `${HEADER}${built.outputFiles[0]!.text}`
}

// Under mutation testing the sources are instrumented, so only the behaviour can be compared.
const INSTRUMENTED = readFileSync(new URL('../src/character.ts', import.meta.url), 'utf8').includes(
  '@ts-nocheck',
)

describe('the character rules the plugin carries', () => {
  it.skipIf(INSTRUMENTED)('are exactly the protocol’s, bundled', async () => {
    const fresh = await characterRulesModule()
    if (process.env.HB_WRITE_PLUGIN_BUNDLES === '1') await writeFile(MODULE, fresh)
    expect(await readFile(MODULE, 'utf8')).toBe(fresh)
    expect(fresh).not.toContain('import(')
  })

  it('give the same answers as the protocol', async () => {
    const bundled = await import(MODULE)
    const otter = {
      version: 1,
      base: 'bubble-16',
      id: 'my-otter',
      name: 'Otter',
      palette: { B: '#8A6A52' },
      marks: [[15, 6, 1, 1, '#2E2018']],
    }
    for (const spec of [otter, { ...otter, id: 'cat' }, { ...otter, marks: [[12, 9, 1, 1, 'B']] }, null])
      expect(bundled.characterProblems(spec)).toEqual(characterProblems(spec))
    expect(bundled.CHOOSABLE_CHARACTERS).toHaveLength(23)
    expect(bundled.characterLink('https://h.example', otter)).toBe(
      characterLink('https://h.example', otter as never),
    )
  })
})
