import { expect, test } from 'claude-code/testing'
import { T } from '../hooks/kernel.mjs'

import { BUNDLED_CLI, DEFAULT_COMMAND, commandOf, lastJsonLine, run } from '../hooks/command-line'

test('a configured command is split into words and used as given', async () => {
  const machine = machineWith({})
  expect(await T.runPromise(commandOf(machine, { command: ' node  /opt/homingbird.js ' }))).toEqual({
    kind: 'ready',
    argv: ['node', '/opt/homingbird.js'],
  })
  expect(machine.versionChecks).toEqual([])
})

test('a configured path to node runs the copy of the command line that comes with the plugin', async () => {
  const node = '/Users/ana/.nvm/versions/node/v22.12.0/bin/node'
  const machine = machineWith({ versions: { [node]: 'v22.12.0' } })
  expect(await T.runPromise(commandOf(machine, { command: node }))).toEqual({
    kind: 'ready',
    argv: [node, '--no-warnings', BUNDLED],
  })
})

test('with no command configured, the copy that comes with the plugin runs on the node on PATH', async () => {
  const machine = machineWith({ versions: { node: 'v22.3.0' } })
  expect(await T.runPromise(commandOf(machine, { command: '' }))).toEqual({
    kind: 'ready',
    argv: ['node', '--no-warnings', BUNDLED],
  })
})

test('the node version is checked once and the command kept for the session', async () => {
  const machine = machineWith({ versions: { node: 'v24.1.0' } })
  const options = {}
  await T.runPromise(commandOf(machine, options))
  await T.runPromise(commandOf(machine, options))
  expect(machine.versionChecks).toEqual(['node'])
})

test('without node on PATH, the newest nvm node of 22 or newer is used', async () => {
  const machine = machineWith({
    environment: { HOME: '/Users/ana' },
    versionDirectories: { '/Users/ana/.nvm/versions/node': ['v20.11.0', 'v22.2.0', 'v22.12.0', 'v18.0.0'] },
    versions: { '/Users/ana/.nvm/versions/node/v22.12.0/bin/node': 'v22.12.0' },
  })
  expect(await T.runPromise(commandOf(machine, {}))).toEqual({
    kind: 'ready',
    argv: ['/Users/ana/.nvm/versions/node/v22.12.0/bin/node', '--no-warnings', BUNDLED],
  })
  expect(machine.versionChecks).toEqual(['node', '/Users/ana/.nvm/versions/node/v22.12.0/bin/node'])
})

test('NVM_DIR and FNM_DIR are honoured where they point', async () => {
  const fromNvm = machineWith({
    environment: { HOME: '/home/ana', NVM_DIR: '/opt/nvm' },
    versionDirectories: { '/opt/nvm/versions/node': ['v23.0.0'] },
    versions: { '/opt/nvm/versions/node/v23.0.0/bin/node': 'v23.0.0' },
  })
  expect(await T.runPromise(commandOf(fromNvm, {}))).toEqual({
    kind: 'ready',
    argv: ['/opt/nvm/versions/node/v23.0.0/bin/node', '--no-warnings', BUNDLED],
  })
  const fromFnm = machineWith({
    environment: { HOME: '/home/ana', FNM_DIR: '/opt/fnm' },
    versions: { '/opt/fnm/aliases/default/bin/node': 'v22.0.0' },
  })
  expect(await T.runPromise(commandOf(fromFnm, {}))).toEqual({
    kind: 'ready',
    argv: ['/opt/fnm/aliases/default/bin/node', '--no-warnings', BUNDLED],
  })
})

test('volta, asdf, fnm and Homebrew locations are tried in order, by existence before running them', async () => {
  for (const path of [
    '/Users/ana/.volta/bin/node',
    '/Users/ana/.asdf/shims/node',
    '/Users/ana/.local/share/fnm/aliases/default/bin/node',
    '/Users/ana/Library/Application Support/fnm/aliases/default/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ]) {
    const machine = machineWith({ environment: { HOME: '/Users/ana' }, versions: { [path]: 'v22.1.0' } })
    expect(await T.runPromise(commandOf(machine, {}))).toEqual({
      kind: 'ready',
      argv: [path, '--no-warnings', BUNDLED],
    })
    expect(machine.versionChecks).toEqual(['node', path])
  }
})

test('a node older than 22 is passed over, and named when nothing newer exists', async () => {
  const machine = machineWith({
    environment: { HOME: '/Users/ana' },
    versions: { node: 'v20.11.1', '/usr/local/bin/node': 'v18.0.0' },
  })
  expect(await T.runPromise(commandOf(machine, {}))).toEqual({ kind: 'no-node', olderVersion: 'v20.11.1' })
  const ran = await T.runPromise(run(machine, { options: {}, server: '' }, ['overview']))
  expect(ran).toMatchObject({ kind: 'no-node', olderVersion: 'v20.11.1' })
  expect((ran as { message: string }).message).toContain('Node v20.11.1 is too old')
})

test('with no node anywhere, the command says what to do instead of failing to start', async () => {
  const machine = machineWith({ environment: { HOME: '/Users/ana' } })
  const ran = await T.runPromise(run(machine, { options: {}, server: '' }, ['overview']))
  expect(ran).toMatchObject({ kind: 'no-node', olderVersion: null })
  expect((ran as { message: string }).message).toContain('Node 22 or newer was not found')
  expect((ran as { message: string }).message).toContain('Homingbird plugin settings (/plugin)')
  expect(machine.commandsRun).toEqual([])
})

test('a plugin folder without its copy of the command line falls back to npx beside the node it found', async () => {
  const onPath = machineWith({ bundled: false, versions: { node: 'v22.0.0', npx: '10.0.0' } })
  expect(await T.runPromise(commandOf(onPath, {}))).toEqual({
    kind: 'ready',
    argv: DEFAULT_COMMAND.split(' '),
  })
  const homebrew = machineWith({
    bundled: false,
    versions: { '/opt/homebrew/bin/node': 'v22.0.0', '/opt/homebrew/bin/npx': '10.0.0' },
  })
  expect(await T.runPromise(commandOf(homebrew, {}))).toEqual({
    kind: 'ready',
    argv: ['/opt/homebrew/bin/npx', '-y', '@homingbird/cli'],
  })
  const noNpm = machineWith({ bundled: false, versions: { node: 'v22.0.0' } })
  expect(await T.runPromise(commandOf(noNpm, {}))).toEqual({ kind: 'no-node', olderVersion: null })
})

test('only the last line of output is read as JSON', () => {
  expect(lastJsonLine('progress\n{"ok":true}\n')).toEqual({ ok: true })
  expect(lastJsonLine('not json')).toBeNull()
})

const ROOT = '/plugins/homingbird'
const BUNDLED = `${ROOT}/${BUNDLED_CLI}`

interface Machine {
  readonly bundled?: boolean
  readonly environment?: Readonly<Record<string, string>>
  readonly versions?: Readonly<Record<string, string>>
  readonly versionDirectories?: Readonly<Record<string, ReadonlyArray<string>>>
}

const machineWith = (machine: Machine) => {
  const versionChecks: string[] = []
  const commandsRun: string[][] = []
  const versions = machine.versions ?? {}
  return {
    versionChecks,
    commandsRun,
    plugin: { name: 'homingbird', root: ROOT },
    env: { get: async (name: string) => machine.environment?.[name] },
    fs: {
      stat: async (path: string) => {
        if (path !== BUNDLED || machine.bundled === false) throw new Error(`ENOENT: ${path}`)
        return { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }
      },
      exists: async (path: string) => Object.hasOwn(versions, path),
      list: async (path?: string) => {
        const names = machine.versionDirectories?.[path ?? '']
        if (names === undefined) throw new Error(`ENOENT: ${path}`)
        return names.map((name) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }))
      },
    },
    process: {
      run: async (argv: readonly string[]) => {
        const [executable = '', first] = argv
        if (first !== '--version') {
          commandsRun.push([...argv])
          return { exitCode: 0, stdout: '{}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        }
        if (!executable.endsWith('npx')) versionChecks.push(executable)
        const version = versions[executable]
        if (version === undefined) throw new Error(`spawn ${executable} ENOENT`)
        return {
          exitCode: 0,
          stdout: `${version}\n`,
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        }
      },
    },
  }
}
