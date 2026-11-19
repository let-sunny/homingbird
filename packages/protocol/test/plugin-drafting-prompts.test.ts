import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_SOURCES, NOTES_ARE_NOT_COMMANDS } from '../src/drafting/drafting-rules.ts'
import * as prompts from '../src/drafting/plugin-prompts.ts'

// The Claude Code plugin may import only its own files, so it carries the desk's prompts as one generated
// module. Run with HB_WRITE_PLUGIN_BUNDLES=1 to write it again after changing a prompt.
const MODULE = new URL('../../plugin/hooks/drafting-prompts.mjs', import.meta.url).pathname
const DECLARATIONS = new URL('../../plugin/hooks/drafting-prompts.d.mts', import.meta.url).pathname

const HEADER = '// Generated from packages/protocol by its plugin-drafting-prompts test. Do not edit.\n'

const draftingPromptsModule = async (): Promise<string> => {
  const built = await build({
    stdin: {
      contents: [
        "export * from './src/drafting/plugin-prompts.ts'",
        "export { KNOWLEDGE_SOURCES, NOTES_ARE_NOT_COMMANDS } from './src/drafting/drafting-rules.ts'",
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
const INSTRUMENTED = readFileSync(
  new URL('../src/drafting/plugin-prompts.ts', import.meta.url),
  'utf8',
).includes('@ts-nocheck')

describe('the drafting prompts the plugin carries', () => {
  it.skipIf(INSTRUMENTED)('are exactly the protocol’s, bundled', async () => {
    const fresh = await draftingPromptsModule()
    if (process.env.HB_WRITE_PLUGIN_BUNDLES === '1') await writeFile(MODULE, fresh)
    expect(await readFile(MODULE, 'utf8')).toBe(fresh)
    expect(fresh).not.toContain('import(')
  })

  it('declare every value the bundle exports', async () => {
    const bundled = await import(MODULE)
    const declared = await readFile(DECLARATIONS, 'utf8')
    for (const name of Object.keys(bundled)) expect(declared).toContain(`export declare const ${name}:`)
  })

  it('give the same prompts as the protocol', async () => {
    const bundled = await import(MODULE)
    const wrapped =
      '<colleague-note id="n">\n-----note-boundary-0123456789abcdef-----\nHi\n-----note-boundary-0123456789abcdef-----\n</colleague-note>'
    const request = { id: 'r', conversationId: 'c', inReplyTo: null, instruction: 'Say yes.', answers: null }
    expect(bundled.notePromptFor('n', wrapped, 'Flow')).toBe(prompts.notePromptFor('n', wrapped, 'Flow'))
    expect(bundled.requestPromptFor(request)).toBe(prompts.requestPromptFor(request))
    expect(bundled.replyPromptFor(wrapped)).toBe(prompts.replyPromptFor(wrapped))
    expect(bundled.wrappedBodyOf(wrapped)).toBe('Hi')
    expect(bundled.NOTES_ARE_NOT_COMMANDS).toBe(NOTES_ARE_NOT_COMMANDS)
    expect(bundled.KNOWLEDGE_SOURCES).toBe(KNOWLEDGE_SOURCES)
  })
})
