import { readFile, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

// The Claude Code mod may import only its own files, so it carries the character rules as one generated
// module. Run with HB_WRITE_MOD_BUNDLE=1 to write it again after changing the rules.
const MODULE = new URL('../../mod/hooks/character-rules.mjs', import.meta.url).pathname

const HEADER = '// Generated from packages/protocol by its mod-character-rules test. Do not edit.\n'

const characterRulesModule = async (): Promise<string> => {
  const built = await build({
    stdin: {
      contents: [
        "export { characterProblems, BUILT_IN_CHARACTERS } from './src/character.ts'",
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

describe('the character rules the mod carries', () => {
  it('are exactly the protocol’s, bundled', async () => {
    const fresh = await characterRulesModule()
    if (process.env.HB_WRITE_MOD_BUNDLE === '1') await writeFile(MODULE, fresh)
    expect(await readFile(MODULE, 'utf8')).toBe(fresh)
    expect(fresh).not.toContain('import(')
  })

  it('give the same answers as the protocol', async () => {
    const bundled = await import(MODULE)
    const { characterProblems, characterLink } = await import('../src/index.ts')
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
    expect(bundled.BUILT_IN_CHARACTERS).toHaveLength(24)
    expect(bundled.characterLink('https://h.example', otter)).toBe(
      characterLink('https://h.example', otter as never),
    )
  })
})
