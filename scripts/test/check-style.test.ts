import { describe, expect, it } from 'vitest'
import { checkAsync, checkSource, unimportedExports, unusedLanguageKeys } from '../check-style.ts'

const messagesOf = (file: string, text: string): string[] =>
  checkAsync(file, text).map((violation) => `${violation.line}: ${violation.message}`)

describe('async and await', () => {
  it('refuses async functions, await and for await outside the kernel', () => {
    const text = [
      'export const read = async () => {',
      '  await fetchIt()',
      '  for await (const line of lines) use(line)',
      '}',
      'export const method = { async go() {} }',
    ].join('\n')
    expect(messagesOf('packages/dovecote/src/sql/sqlite.ts', text)).toEqual([
      expect.stringMatching(/^1: async functions belong in the kernel/),
      expect.stringMatching(/^2: await belongs in the kernel/),
      expect.stringMatching(/^3: for await belongs in the kernel/),
      expect.stringMatching(/^5: async functions belong in the kernel/),
    ])
  })

  it('allows them in the kernel only', () => {
    const text = 'export const read = async () => { await later() }'
    expect(messagesOf('packages/kernel/src/task.ts', text)).toEqual([])
    for (const file of [
      'packages/cli/src/cli.ts',
      'packages/pwa/src/app.ts',
      'packages/plugin/hooks/desk.ts',
    ])
      expect(messagesOf(file, text)).toHaveLength(2)
  })

  it('allows only a top-level await of T.run or T.runPromise in a listed program entry file', () => {
    expect(messagesOf('packages/dovecote/src/main.ts', 'const ended = await T.run(program, {})')).toEqual([])
    expect(messagesOf('packages/mcp/src/stdio.ts', 'const exit = await Task.run(program, {})')).toEqual([])
    expect(messagesOf('packages/cli/src/main.ts', 'if (go) { await T.runPromise(program, {}) }')).toEqual([])
    expect(messagesOf('packages/dovecote/src/main.ts', 'await database.close()')).toEqual([
      expect.stringMatching(/^1: await belongs in the kernel/),
    ])
    expect(messagesOf('packages/dovecote/src/main.ts', 'const f = () => T.run(x)\nawait f()')).toHaveLength(1)
    expect(
      messagesOf('packages/dovecote/src/sql/open.ts', 'export const x = await T.run(program, {})'),
    ).toHaveLength(1)
    expect(messagesOf('packages/pwa/src/main.ts', 'await T.run(program, {})')).toHaveLength(1)
  })

  it('is part of every source check', () => {
    expect(
      checkSource('packages/dovecote/src/sql/open.ts', 'export const open = async () => {}').map(
        (violation) => violation.message,
      ),
    ).toEqual([expect.stringMatching(/async functions belong in the kernel/)])
  })
})

describe('language keys', () => {
  const language = {
    file: 'packages/pwa/src/languages/en.ts',
    text: [
      'export const en = {',
      "  used: 'Used',",
      "  'quoted-key': 'Quoted',",
      "  unused: 'Never shown',",
      '  nested: {',
      "    shown: 'Shown',",
      "    hidden: 'Hidden',",
      '  },',
      '  byTag: {',
      "    first: 'A',",
      "    second: 'B',",
      '  } satisfies Record<string, string>,',
      '  listed: {',
      "    one: 'One',",
      '  },',
      '}',
    ].join('\n'),
  }
  const view = {
    file: 'packages/pwa/src/views/view.ts',
    text: [
      'export const show = (strings: Strings, tag: string) => [',
      '  strings.used,',
      "  strings['quoted-key'],",
      '  strings.nested.shown,',
      '  strings.byTag[tag],',
      '  ...Object.values(strings.listed),',
      ']',
    ].join('\n'),
  }

  it('names each key no source uses, with its path and line', () => {
    expect(unusedLanguageKeys(language, [view])).toEqual([
      {
        file: language.file,
        line: 4,
        message: 'language key unused is never used; delete it from every language',
      },
      {
        file: language.file,
        line: 7,
        message: 'language key nested.hidden is never used; delete it from every language',
      },
    ])
  })

  it('counts a key read by index or as a whole as using every key inside it', () => {
    const messages = unusedLanguageKeys(language, [view]).map((violation) => violation.message)
    expect(messages.join(' ')).not.toMatch(/byTag|first|second|listed|one/)
  })

  it('reports every key when no source reads the language', () => {
    expect(unusedLanguageKeys(language, [])).toHaveLength(11)
  })
})

describe('exports nothing imports', () => {
  const layout = {
    entries: new Set(['packages/a/src/index.ts']),
    packages: new Map([['@homingbird/a', 'packages/a/src/index.ts']]),
  }
  const isSource = (file: string): boolean => file.includes('/src/')
  const unimported = (files: Record<string, string>): string[] =>
    unimportedExports(
      Object.entries(files).map(([file, text]) => ({ file, text })),
      isSource,
      layout,
    ).map((violation) => `${violation.file}:${violation.line} ${violation.message.split(' ')[0]}`)

  it('names exported values no other file imports, and ignores types', () => {
    expect(
      unimported({
        'packages/a/src/notes.ts': [
          'export const sendNote = 1',
          'export function discardNote() {}',
          'export const { spread } = thing',
          'export type NoteId = string',
          'export interface Note {}',
          'const local = 2',
          'export { local, type NoteId as Id }',
        ].join('\n'),
      }),
    ).toEqual([
      'packages/a/src/notes.ts:1 sendNote',
      'packages/a/src/notes.ts:2 discardNote',
      'packages/a/src/notes.ts:7 local',
    ])
  })

  it('counts named, renamed, default, re-exported and dynamic imports, from sources and tests alike', () => {
    expect(
      unimported({
        'packages/a/src/one.ts': 'export const one = 1\nexport const unused = 0',
        'packages/a/src/two.ts': 'export const two = 2',
        'packages/a/src/three.ts': 'export const three = 3',
        'packages/a/src/four.ts': 'export const four = 4',
        'packages/a/src/five/index.ts': 'export const five = 5',
        'packages/a/src/index.ts': "export { two as second } from './two.ts'\nexport * from './three.ts'",
        'packages/a/test/one.test.ts': [
          "import { one as first } from '../src/one.ts'",
          "import { five } from '../src/five'",
          "const later = import('../src/four.js')",
        ].join('\n'),
      }),
    ).toEqual(['packages/a/src/one.ts:2 unused'])
  })

  it('follows a namespace import to the names read from it', () => {
    expect(
      unimported({
        'packages/a/src/task.ts': 'export const run = 1\nexport const fork = 2\nexport type Task = number',
        'packages/a/src/use.ts': "import * as T from './task.ts'\nexport const go = T.run\nlet typed: T.Task",
        'packages/a/test/use.test.ts': "import { go } from '../src/use.ts'",
      }),
    ).toEqual(['packages/a/src/task.ts:2 fork'])
    expect(
      unimported({
        'packages/a/src/task.ts': 'export const run = 1\nexport const fork = 2',
        'packages/a/src/use.ts': "import * as T from './task.ts'\nexport const all = [T]",
        'packages/a/test/use.test.ts': "import { all } from '../src/use.ts'",
      }),
    ).toEqual([])
  })

  it('resolves package names and leaves entries, unknown modules and unchecked files alone', () => {
    expect(
      unimported({
        'packages/a/src/index.ts': 'export const surface = 1',
        'packages/b/src/use.ts': "import { surface } from '@homingbird/a'\nimport { x } from 'node:fs'",
        'packages/b/test/use.test.ts': "import * as all from '../src/use.ts'\nexport const helper = all",
        'scripts/tool.ts': "import { gone } from './missing.ts'\nexport const tool = 1",
      }),
    ).toEqual([])
  })
})
