import { expect, test } from 'claude-code/testing'

import { BUNDLED_CLI, DEFAULT_COMMAND, commandOf, lastJsonLine } from '../hooks/command-line'

test('a configured command is split into words and used as given', async () => {
  expect(await commandOf(engineWith(ROOT_WITH_CLI), { command: ' node  /opt/homingbird.js ' })).toEqual([
    'node',
    '/opt/homingbird.js',
  ])
})

test('with no command configured, the copy of the command line that comes with the mod runs on node', async () => {
  const bundled = `${ROOT_WITH_CLI}/${BUNDLED_CLI}`
  expect(await commandOf(engineWith(ROOT_WITH_CLI), { command: '' })).toEqual([
    'node',
    '--no-warnings',
    bundled,
  ])
  expect(await commandOf(engineWith(ROOT_WITH_CLI), {})).toEqual(['node', '--no-warnings', bundled])
})

test('a mod folder without its copy of the command line falls back to the published one', async () => {
  expect(await commandOf(engineWith('/checkout/packages/mod'), {})).toEqual(DEFAULT_COMMAND.split(' '))
  expect(DEFAULT_COMMAND).toBe('npx -y @homingbird/cli')
})

test('only the last line of output is read as JSON', () => {
  expect(lastJsonLine('progress\n{"ok":true}\n')).toEqual({ ok: true })
  expect(lastJsonLine('not json')).toBeNull()
})

const ROOT_WITH_CLI = '/plugins/homingbird'

const engineWith = (root: string) => ({
  plugin: { name: 'homingbird', root },
  fs: {
    stat: async (path: string) => {
      if (path !== `${ROOT_WITH_CLI}/${BUNDLED_CLI}`) throw new Error(`ENOENT: ${path}`)
      return { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }
    },
  },
})
