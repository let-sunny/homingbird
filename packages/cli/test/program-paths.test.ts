import { Task as T } from '@homingbird/kernel'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { agentCommand } from '../src/agent-presets.ts'
import type { Programs } from '../src/environment.ts'
import {
  STABLE_PATH_ADVICE,
  candidatesFor,
  lastingPathOf,
  missingPresetCommand,
  programWord,
  resolvedProgram,
  stablePath,
  unstablePathWarning,
  unstablePathWarningFor,
  versionManagerOf,
} from '../src/program-paths.ts'

const lookup = (
  runnable: ReadonlyArray<string>,
  links: Readonly<Record<string, string>> = {},
  platform = 'linux',
  variables: Readonly<Record<string, string | undefined>> = {},
) => {
  const programs: Programs = {
    realPath: async (path) => links[path] ?? (runnable.includes(path) ? path : null),
    isRunnable: async (path) => runnable.includes(path),
  }
  const env = { programs, platform, variables, homeDirectory: '/home/ana' }
  return <A>(task: T.Task<A, never, typeof env>) => T.runPromise(task, env)
}

describe('candidatesFor', () => {
  it('looks in each PATH directory in order, as a POSIX shell does', () => {
    expect(candidatesFor('codex', '/usr/local/bin:/usr/bin/::/opt/bin', 'darwin', null)).toEqual([
      '/usr/local/bin/codex',
      '/usr/bin/codex',
      '/opt/bin/codex',
    ])
  })

  it('tries each PATHEXT extension on Windows, and only the name itself when it has one', () => {
    expect(candidatesFor('claude', 'C:\\bin;D:\\tools\\', 'win32', '.EXE;.CMD')).toEqual([
      'C:\\bin\\claude.exe',
      'C:\\bin\\claude.cmd',
      'D:\\tools\\claude.exe',
      'D:\\tools\\claude.cmd',
    ])
    expect(candidatesFor('claude.cmd', 'C:\\bin', 'win32', null)).toEqual(['C:\\bin\\claude.cmd'])
    expect(candidatesFor('claude', 'C:\\bin', 'win32', null)).toHaveLength(4)
  })

  it('takes an absolute path as it is, and gives up on a relative one, which depends on the directory', () => {
    expect(candidatesFor('/opt/agent/bin/agent', '/usr/bin', 'linux', null)).toEqual(['/opt/agent/bin/agent'])
    expect(candidatesFor('C:\\agent\\agent.exe', '', 'win32', null)).toEqual(['C:\\agent\\agent.exe'])
    expect(candidatesFor('./agent.sh', '/usr/bin', 'linux', null)).toEqual([])
  })

  it('reads a Windows PATH entry in quotes as the directory inside them', () => {
    expect(candidatesFor('codex.cmd', '"C:\\Program Files\\nodejs";C:\\bin', 'win32', null)).toEqual([
      'C:\\Program Files\\nodejs\\codex.cmd',
      'C:\\bin\\codex.cmd',
    ])
  })

  it('expands a leading ~ to the home directory on POSIX, in PATH entries and in the program', () => {
    expect(candidatesFor('agent', '~/bin:~:/usr/bin:/x/~y', 'darwin', null, '/Users/ana')).toEqual([
      '/Users/ana/bin/agent',
      '/Users/ana/agent',
      '/usr/bin/agent',
      '/x/~y/agent',
    ])
    expect(candidatesFor('~/bin/agent', '', 'linux', null, '/home/ana')).toEqual(['/home/ana/bin/agent'])
    expect(candidatesFor('~/bin/agent', '', 'linux', null)).toEqual([])
  })

  it('never yields a candidate outside the PATH for a plain name', () => {
    const directory = fc.stringMatching(/^\/[a-z]{1,8}$/)
    fc.assert(
      fc.property(fc.array(directory, { maxLength: 5 }), (directories) => {
        const found = candidatesFor('agent', directories.join(':'), 'linux', null)
        expect(found).toEqual(directories.map((each) => `${each}/agent`))
      }),
    )
  })
})

describe('programWord', () => {
  it('is the first word of a plain command, and null when the shell would do more than look it up', () => {
    expect(programWord(agentCommand('codex'))).toBe('codex')
    expect(programWord('  /opt/bin/agent --fast')).toBe('/opt/bin/agent')
    expect(programWord('A=1 agent')).toBeNull()
    expect(programWord('"$HOME/bin/agent"')).toBeNull()
    expect(programWord('')).toBeNull()
  })
})

describe('resolvedProgram', () => {
  it('finds the first runnable candidate, keeping a lasting link as it is', async () => {
    const run = lookup(['/b/claude', '/c/claude'], { '/b/claude': '/real/claude.js' })
    expect(await run(resolvedProgram('claude -p', '/a:/b:/c'))).toBe('/b/claude')
    expect(await run(resolvedProgram('missing', '/a:/b'))).toBeNull()
    expect(await run(resolvedProgram('cd /x && claude', '/b'))).toBeNull()
  })

  it('follows the link of a program found in a per-shell directory, which vanishes with the shell', async () => {
    const shell = '/Users/ana/.local/state/fnm_multishells/1_2/bin'
    const run = lookup([`${shell}/claude`], { [`${shell}/claude`]: '/fnm/v22/bin/claude' })
    expect(await run(resolvedProgram('claude -p', shell))).toBe('/fnm/v22/bin/claude')
  })

  it('looks under the home directory for a ~ on the PATH', async () => {
    const run = lookup(['/home/ana/.local/bin/claude'])
    expect(await run(resolvedProgram('claude -p', '~/.local/bin'))).toBe('/home/ana/.local/bin/claude')
  })

  it('reads PATHEXT on Windows', async () => {
    const run = lookup(['C:\\bin\\codex.ps1'], {}, 'win32', { PATHEXT: '.PS1' })
    expect(await run(resolvedProgram('codex exec -', 'C:\\bin'))).toBe('C:\\bin\\codex.ps1')
  })
})

describe('missingPresetCommand', () => {
  it('names the first preset command whose program is missing, and checks no command of one’s own', async () => {
    const run = lookup(['/usr/bin/claude'])
    const codex = agentCommand('codex')
    expect(await run(missingPresetCommand(['claude -p', codex], '/usr/bin'))).toBe(codex)
    expect(await run(missingPresetCommand(['claude -p', 'my-agent'], '/usr/bin'))).toBeNull()
  })

  it('checks nothing when no PATH is set, since the shell then decides', async () => {
    expect(await lookup([])(missingPresetCommand([agentCommand('codex')], undefined))).toBeNull()
  })
})

describe('stablePath', () => {
  const SHELL = '/Users/ana/.local/state/fnm_multishells/4242_1700/bin'

  it('replaces only a per-shell directory with where it leads, keeping order, missing ones and empty entries', async () => {
    const run = lookup([], { [SHELL]: '/fnm/v22/bin', '/usr/bin': '/usr/bin' })
    expect(await run(stablePath(`${SHELL}:/usr/bin:/gone:/usr/bin`, 'darwin'))).toBe(
      '/fnm/v22/bin:/usr/bin:/gone',
    )
    expect(await run(stablePath('C:\\a;;C:\\b', 'win32'))).toBe('C:\\a;;C:\\b')
  })

  it('keeps Homebrew’s opt links and a Nix profile as they are, never pinning them to one version', async () => {
    const run = lookup([], {
      '/opt/homebrew/opt/node@22/bin': '/opt/homebrew/Cellar/node@22/22.12.0/bin',
      '/Users/ana/.nix-profile/bin': '/nix/store/abc123-home-manager-path/bin',
      '/run/current-system/sw/bin': '/nix/store/def456-system-path/bin',
    })
    const path = '/opt/homebrew/opt/node@22/bin:/Users/ana/.nix-profile/bin:/run/current-system/sw/bin'
    expect(await run(stablePath(path, 'darwin'))).toBe(path)
  })
})

describe('lastingPathOf', () => {
  it('follows the link of a per-shell path only', async () => {
    const run = lookup([], {
      '/s/fnm_multishells/1/bin/node': '/fnm/v22/bin/node',
      '/opt/homebrew/opt/node@22/bin/node': '/opt/homebrew/Cellar/node@22/22.12.0/bin/node',
      '/Users/ana/.nix-profile/bin/node': '/nix/store/abc-nodejs-22/bin/node',
    })
    expect(await run(lastingPathOf('/s/fnm_multishells/1/bin/node'))).toBe('/fnm/v22/bin/node')
    expect(await run(lastingPathOf('/opt/homebrew/opt/node@22/bin/node'))).toBe(
      '/opt/homebrew/opt/node@22/bin/node',
    )
    expect(await run(lastingPathOf('/Users/ana/.nix-profile/bin/node'))).toBe(
      '/Users/ana/.nix-profile/bin/node',
    )
  })
})

describe('unstablePathWarningFor', () => {
  it('warns about a shim that leads into a version manager, and not about Homebrew or Nix links', async () => {
    const run = lookup([], {
      '/usr/local/bin/claude': '/home/ana/.nvm/versions/node/v22/lib/node_modules/claude/cli.js',
      '/opt/homebrew/opt/node@22/bin/node': '/opt/homebrew/Cellar/node@22/22.12.0/bin/node',
      '/Users/ana/.nix-profile/bin/node': '/nix/store/abc-nodejs-22/bin/node',
    })
    expect(await run(unstablePathWarningFor('The agent', '/usr/local/bin/claude'))).toMatch(/belongs to nvm/)
    expect(await run(unstablePathWarningFor('Node', '/opt/homebrew/opt/node@22/bin/node'))).toBeNull()
    expect(await run(unstablePathWarningFor('Node', '/Users/ana/.nix-profile/bin/node'))).toBeNull()
  })
})

describe('versionManagerOf', () => {
  it.each([
    ['/Users/ana/.local/state/fnm_multishells/4242_1700/bin/node', 'fnm', true],
    ['C:\\Users\\june\\AppData\\Local\\fnm_multishells\\1_2\\node.exe', 'fnm', true],
    ['/Users/ana/.local/share/fnm/node-versions/v22.12.0/installation/bin/node', 'fnm', false],
    ['/home/ana/.nvm/versions/node/v22.12.0/bin/node', 'nvm', false],
    ['C:\\Users\\june\\AppData\\Roaming\\nvm\\v22.12.0\\node.exe', 'nvm', false],
    ['/Users/ana/.volta/tools/image/node/22.12.0/bin/node', 'Volta', false],
    ['/home/ana/.asdf/shims/node', 'asdf', false],
    ['/home/ana/.local/share/mise/installs/node/22/bin/node', 'mise', false],
  ])('knows %s belongs to %s', (path, name, isTemporary) => {
    expect(versionManagerOf(path)).toMatchObject({ name, isTemporary })
  })

  it.each([
    '/opt/homebrew/bin/node',
    '/opt/homebrew/Cellar/node@22/22.12.0/bin/node',
    '/Users/ana/.nix-profile/bin/node',
    '/nix/store/abc-nodejs-22/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    'C:\\Program Files\\nodejs\\node.exe',
  ])('finds no version manager in %s', (path) => {
    expect(versionManagerOf(path)).toBeNull()
    expect(unstablePathWarning('Node', path)).toBeNull()
  })
})

describe('unstablePathWarning', () => {
  it('says a per-shell directory disappears, and how to give a stable path', () => {
    expect(unstablePathWarning('Node', '/s/fnm_multishells/1/bin/node')).toBe(
      `Node /s/fnm_multishells/1/bin/node is in a directory fnm makes for one shell, which disappears when that shell closes. ${STABLE_PATH_ADVICE}`,
    )
  })

  it('says a version manager’s path breaks when the version changes', () => {
    expect(unstablePathWarning('Node', '/home/ana/.nvm/versions/node/v22/bin/node')).toBe(
      `Node /home/ana/.nvm/versions/node/v22/bin/node belongs to nvm, a Node version manager, and breaks when that version is switched or removed. ${STABLE_PATH_ADVICE}`,
    )
  })
})
