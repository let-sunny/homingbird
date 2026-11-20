import { describe, expect, it } from 'vitest'
import { AS_THE_PERSON, STEP_RETRY_MS, STOP_POLL_MS } from '../src/commands/service.ts'
import { DESK_CLAIM_STALE_MS } from '../src/desk-claim.ts'
import { EXIT } from '../src/failure.ts'
import { STABLE_PATH_ADVICE } from '../src/program-paths.ts'
import { AS_THE_PERSON_ON_WINDOWS, RUN_KEY } from '../src/service-run-key.ts'
import { AGENT_FILE, AGENT_TOKEN, HOME, SERVER, world } from './support.ts'

const UNIT = `${HOME}/.config/systemd/user/homingbird-runner-https-hb-example-com.service`
const LOG = `${HOME}/.config/homingbird/logs/runner-https-hb-example-com.log`
const PLIST = `${HOME}/Library/LaunchAgents/homingbird.runner.https-hb-example-com.plist`

const SHOWN_RUNNING =
  'LoadState=loaded\nActiveState=active\nSubState=running\nExecMainStatus=0\nExecMainExitTimestamp=\n'

describe('homingbird service install', () => {
  it('writes the systemd user unit, keeps a private log, and loads it with systemctl --user', async () => {
    const w = world({ variables: { PATH: '/usr/local/bin:/usr/bin' } })
    expect(await w.run('service', 'install', '--server', SERVER, '--agent', 'claude')).toBe(0)
    expect(w.files.get(UNIT)).toContain(
      `ExecStart="/usr/bin/node" "/usr/lib/node_modules/@homingbird/cli/dist/homingbird.js" "run" "--service" "--server" "${SERVER}" "--agent" "claude"`,
    )
    expect(w.files.get(UNIT)).toContain('Environment="PATH=/usr/local/bin:/usr/bin"')
    expect(w.files.get(UNIT)).toContain(`WorkingDirectory=${HOME}`)
    expect(w.ownerOnlyWrites).toEqual([UNIT])
    expect(w.privateWrites).toEqual([LOG])
    expect(w.processRuns).toEqual([
      ['systemctl', '--user', 'daemon-reload'],
      ['systemctl', '--user', 'enable', 'homingbird-runner-https-hb-example-com.service'],
      ['systemctl', '--user', 'restart', 'homingbird-runner-https-hb-example-com.service'],
    ])
    expect(w.lines[0]).toBe(
      [
        'Installed homingbird-runner-https-hb-example-com.service (systemd user service): it starts when you log in and restarts if it stops.',
        `Definition:  ${UNIT}`,
        `Log:         ${LOG}`,
      ].join('\n'),
    )
    expect(w.calls).toEqual([])
  })

  it('keeps an existing log, and never writes the credential into the service', async () => {
    const w = world()
    w.files.set(LOG, 'earlier lines\n')
    await w.run('service', 'install', '--server', SERVER, '--agent', 'claude', '--split', '--workdir', '/srv')
    w.files.set('/srv', '')
    expect(w.files.get(LOG)).toBe('earlier lines\n')
    expect(w.problems[0]).toBe('The working directory /srv does not exist.')
    expect(
      await w.run(
        'service',
        'install',
        '--server',
        SERVER,
        '--agent',
        'claude',
        '--split',
        '--require-toolless-reader',
        '--timeout',
        '90',
        '--workdir',
        '/srv',
      ),
    ).toBe(0)
    expect(w.files.get(LOG)).toBe('earlier lines\n')
    expect(w.files.get(UNIT)).toContain('"--timeout" "90" "--split" "--require-toolless-reader"')
    expect(w.files.get(UNIT)).toContain('WorkingDirectory=/srv')
    expect(w.files.get(UNIT)).not.toContain(AGENT_TOKEN)
  })

  it('installs before sign-in, and says to sign in first', async () => {
    const w = world({ signedIn: 'none' })
    expect(await w.run('service', 'install', '--server', SERVER, '--agent', 'codex', '--json')).toBe(0)
    expect(w.json()).toMatchObject({ installed: true, signedIn: false, log: LOG })
    const text = world({ signedIn: 'none' })
    await text.run('service', 'install', '--server', SERVER, '--agent', 'codex')
    expect(text.lines[0]).toContain(
      `The service waits until you sign in: homingbird login --server ${SERVER}`,
    )
  })

  it('writes a launchd agent on macOS and loads it into the person’s GUI session', async () => {
    const w = world({ platform: 'darwin', userId: 501 })
    expect(await w.run('service', 'install', '--server', SERVER, '--agent', 'claude')).toBe(0)
    expect(w.files.get(PLIST)).toContain('<string>homingbird.runner.https-hb-example-com</string>')
    expect(w.processRuns.map((run) => run.slice(0, 2).join(' '))).toEqual([
      'launchctl bootout',
      'launchctl enable',
      'launchctl bootstrap',
    ])
  })

  it('writes the real paths behind a version manager’s per-shell links into the launchd agent, and warns about them', async () => {
    const SHELL = '/Users/ana/.local/state/fnm_multishells/4242_1700000000000'
    const INSTALLED = '/Users/ana/.local/share/fnm/node-versions/v22.12.0/installation'
    const w = world({
      platform: 'darwin',
      userId: 501,
      variables: { PATH: `${SHELL}/bin:/opt/homebrew/bin:/usr/bin` },
      program: [`${SHELL}/bin/node`, `${SHELL}/bin/homingbird`],
      links: {
        [`${SHELL}/bin`]: `${INSTALLED}/bin`,
        [`${SHELL}/bin/node`]: `${INSTALLED}/bin/node`,
        [`${SHELL}/bin/homingbird`]: `${INSTALLED}/lib/node_modules/@homingbird/cli/dist/homingbird.js`,
        [`${INSTALLED}/bin/claude`]: `${INSTALLED}/lib/node_modules/@anthropic-ai/claude-code/cli.js`,
      },
      runnable: (path) => path === `${INSTALLED}/bin/claude`,
    })
    expect(await w.run('service', 'install', '--server', SERVER, '--agent', 'claude', '--json')).toBe(0)
    const plist = w.files.get(PLIST)!
    expect(plist).not.toContain('fnm_multishells')
    expect(plist).toContain(`<string>${INSTALLED}/bin/node</string>`)
    expect(plist).toContain(
      `<string>${INSTALLED}/lib/node_modules/@homingbird/cli/dist/homingbird.js</string>`,
    )
    expect(plist).toContain(`<string>${INSTALLED}/bin:/opt/homebrew/bin:/usr/bin</string>`)
    const { warnings } = w.json() as { warnings: string[] }
    expect(warnings).toHaveLength(3)
    expect(warnings[0]).toBe(
      `Node ${INSTALLED}/bin/node belongs to fnm, a Node version manager, and breaks when that version is switched or removed. ${STABLE_PATH_ADVICE}`,
    )
    expect(warnings[1]).toMatch(/^The homingbird command line .*homingbird\.js belongs to fnm/)
    expect(warnings[2]).toMatch(/^The agent command’s program .*\/bin\/claude belongs to fnm/)
  })

  it('installs without a warning when Node, the command line and the agent have stable paths', async () => {
    const w = world({
      platform: 'darwin',
      userId: 501,
      variables: { PATH: '/opt/homebrew/bin:/usr/bin' },
      program: [
        '/opt/homebrew/bin/node',
        '/opt/homebrew/lib/node_modules/@homingbird/cli/dist/homingbird.js',
      ],
    })
    expect(await w.run('service', 'install', '--server', SERVER, '--agent', 'claude')).toBe(0)
    expect(w.lines[0]).not.toContain('Warning')
  })

  it('installs Antigravity before it is signed in, and says the service waits until it is', async () => {
    const w = world({
      platform: 'darwin',
      userId: 501,
      process: (program, args) => (program === 'agy' ? { exitCode: null, output: '' } : undefined),
    })
    expect(await w.run('service', 'install', '--server', SERVER, '--agent', 'antigravity')).toBe(0)
    expect(w.lines[0]).toContain(
      'Warning: Antigravity did not answer within 20 seconds, or is not signed in on this computer. Sign in first: run `agy` in a terminal, then start this again. The service waits until then.',
    )
    expect(w.processRuns.filter(([program]) => program === 'agy')).toHaveLength(1)
  })

  it('refuses to install a preset whose program is not on the PATH the service would run with', async () => {
    const w = world({ variables: { PATH: '/usr/local/bin:/usr/bin' }, runnable: () => false })
    expect(await w.run('service', 'install', '--server', SERVER, '--agent', 'codex')).toBe(EXIT.failed)
    expect(w.problems).toEqual([
      'The agent command could not be found: "codex" is not on the PATH this runs with; give its absolute path, such as /usr/local/bin/codex, or set PATH.',
    ])
    expect(w.files.has(UNIT)).toBe(false)
    expect(w.processRuns).toEqual([])
  })

  it('writes the real paths into the Windows Run key too, and warns about a version manager there', async () => {
    const SHELL = 'C:\\Users\\june\\AppData\\Local\\fnm_multishells\\777_1'
    const REAL = 'C:\\Program Files\\nodejs'
    const w = world({
      platform: 'win32',
      userId: null,
      variables: { USERNAME: 'june', PATH: `${SHELL};${REAL}`, PATHEXT: '.EXE;.CMD' },
      program: [`${SHELL}\\node.exe`, `${SHELL}\\node_modules\\@homingbird\\cli\\dist\\homingbird.js`],
      links: {
        [`${SHELL}\\node.exe`]: `${REAL}\\node.exe`,
        [`${SHELL}\\node_modules\\@homingbird\\cli\\dist\\homingbird.js`]: `${REAL}\\node_modules\\@homingbird\\cli\\dist\\homingbird.js`,
      },
      runnable: (path) => path === `${REAL}\\claude.cmd`,
    })
    expect(await w.run('service', 'install', '--server', SERVER, '--agent', 'claude', '--json')).toBe(0)
    const added = w.processRuns.find((run) => run[0] === 'reg' && run[1] === 'add')!
    expect(added.join(' ')).not.toContain('fnm_multishells')
    expect(added.at(-2)).toContain(`"${REAL}\\node.exe"`)
    expect((w.json() as { warnings: string[] }).warnings).toEqual([])
  })

  it('retries loading the launchd agent while launchd still tears down the one just booted out', async () => {
    let refusals = 2
    const w = world({
      platform: 'darwin',
      userId: 501,
      process: (_program, args) =>
        args[0] === 'bootstrap' && refusals-- > 0
          ? { exitCode: 5, output: 'Bootstrap failed: 5: Input/output error' }
          : undefined,
    })
    const installing = w.run('service', 'install', '--server', SERVER, '--agent', 'claude')
    for (let turn = 0; turn < 50 && w.processRuns.filter((run) => run[1] === 'bootstrap').length < 3; turn++)
      await w.clock.advance(STEP_RETRY_MS)
    expect(await installing).toBe(0)
    expect(w.processRuns.filter((run) => run[1] === 'bootstrap')).toHaveLength(3)
  })

  it('refuses to run as root or on a platform it does not know, and checks its options', async () => {
    const root = world({ userId: 0 })
    expect(await root.run('service', 'install', '--server', SERVER, '--agent', 'claude')).toBe(EXIT.failed)
    expect(root.problems).toEqual([AS_THE_PERSON])
    expect(root.processRuns).toEqual([])
    const other = world({ platform: 'aix' })
    expect(await other.run('service', 'install', '--server', SERVER, '--agent', 'claude')).toBe(EXIT.failed)
    expect(other.problems[0]).toBe('The service runs on macOS, Linux and Windows, not on aix.')
    const relative = world()
    expect(
      await relative.run('service', 'install', '--server', SERVER, '--agent', 'claude', '--workdir', 'work'),
    ).toBe(EXIT.usage)
    const broken = world()
    expect(
      await broken.run('service', 'install', '--server', SERVER, '--agent', 'claude\nExecStartPre=x'),
    ).toBe(EXIT.usage)
    expect(broken.files.has(UNIT)).toBe(false)
    const quoted = world({ platform: 'win32', userId: null, variables: { USERNAME: 'june' } })
    expect(await quoted.run('service', 'install', '--server', SERVER, '--agent', 'claude --x "y"')).toBe(
      EXIT.usage,
    )
  })

  it('says which step failed, and where the service file is', async () => {
    const w = world({
      process: (_program, args) =>
        args.includes('daemon-reload')
          ? { exitCode: 1, output: 'Failed to connect to bus: No medium found\n' }
          : undefined,
    })
    expect(await w.run('service', 'install', '--server', SERVER, '--agent', 'claude')).toBe(EXIT.failed)
    expect(w.problems[0]).toBe(
      `\`systemctl --user daemon-reload\` failed (exit code 1): Failed to connect to bus: No medium found\nThe service is defined at ${UNIT}.`,
    )
    const missing = world({
      process: () => {
        throw new Error('spawn systemctl ENOENT')
      },
    })
    expect(await missing.run('service', 'install', '--server', SERVER, '--agent', 'claude')).toBe(EXIT.failed)
    expect(missing.problems[0]).toContain('failed (could not start): spawn systemctl ENOENT')
  })

  it('uses the only server signed in to, and asks which when it cannot tell', async () => {
    const w = world()
    expect(await w.run('service', 'install', '--agent', 'claude')).toBe(0)
    expect(w.files.has(UNIT)).toBe(true)
    const none = world({ signedIn: 'none' })
    expect(await none.run('service', 'status')).toBe(EXIT.usage)
    expect(none.problems[0]).toBe('Say which server with --server <url>.')
  })
})

describe('homingbird service status', () => {
  it('reports installed, running, the last exit and the log', async () => {
    const w = world({ process: () => ({ exitCode: 0, output: SHOWN_RUNNING }) })
    await w.run('service', 'install', '--server', SERVER, '--agent', 'claude')
    expect(await w.run('service', 'status', '--server', SERVER)).toBe(0)
    expect(w.lines.at(-1)).toBe(
      [
        'Service:     homingbird-runner-https-hb-example-com.service (systemd user service)',
        `Installed:   yes, ${UNIT}`,
        'Running:     yes',
        'Last exit:   none',
        `Log:         ${LOG}`,
      ].join('\n'),
    )
    expect(w.processRuns.at(-1)).toEqual([
      'systemctl',
      '--user',
      'show',
      'homingbird-runner-https-hb-example-com.service',
      '--property=LoadState,ActiveState,SubState,ExecMainStatus,ExecMainExitTimestamp',
    ])
  })

  it('says which version of the agent’s program the running service started with', async () => {
    const w = world({ process: () => ({ exitCode: 0, output: SHOWN_RUNNING }) })
    await w.run('service', 'install', '--server', SERVER, '--agent', 'claude')
    w.files.set(
      `${HOME}/.config/homingbird/desks/service-https-hb-example-com.agents`,
      'Claude Code: 2.1.329, needs 2.1.259 or later; verified with Claude Code 2.1.327\n',
    )
    expect(await w.run('service', 'status', '--server', SERVER)).toBe(0)
    expect(w.lines.at(-1)).toContain(
      'Running:     yes\nAgent:       Claude Code: 2.1.329, needs 2.1.259 or later; verified with Claude Code 2.1.327\n',
    )
  })

  it('says when the running service waits for a missing program, as the service wrote it', async () => {
    const w = world({ process: () => ({ exitCode: 0, output: SHOWN_RUNNING }) })
    await w.run('service', 'install', '--server', SERVER, '--agent', 'claude')
    w.files.set(
      `${HOME}/.config/homingbird/desks/service-https-hb-example-com.missing`,
      'The agent command could not be found: "claude" is not on the PATH this runs with; give its absolute path, such as /usr/local/bin/claude, or set PATH.',
    )
    expect(await w.run('service', 'status', '--server', SERVER)).toBe(0)
    expect(w.lines.at(-1)).toContain(
      'Running:     yes, waiting for a missing program\nWaiting:     The agent command could not be found: "claude" is not on the PATH this runs with; give its absolute path, such as /usr/local/bin/claude, or set PATH.',
    )
    await w.run('service', 'status', '--server', SERVER, '--json')
    expect(w.json()).toMatchObject({
      running: true,
      waitingFor:
        'The agent command could not be found: "claude" is not on the PATH this runs with; give its absolute path, such as /usr/local/bin/claude, or set PATH.',
    })
  })

  it('says to sign in first when there is no credential for the server', async () => {
    const w = world({ signedIn: 'none' })
    expect(await w.run('service', 'status', '--server', SERVER)).toBe(0)
    expect(w.lines[0]).toBe(
      [
        'Service:     homingbird-runner-https-hb-example-com.service (systemd user service)',
        'Installed:   no',
        `Log:         ${LOG}`,
        `Sign in first: homingbird login --server ${SERVER}`,
      ].join('\n'),
    )
    expect(w.processRuns).toEqual([])
    await w.run('service', 'status', '--server', SERVER, '--json')
    expect(w.json()).toMatchObject({ installed: false, running: false, signedIn: false, log: LOG })
  })

  it('tells a stopped service from one that is not loaded', async () => {
    const stopped = world({
      process: () => ({
        exitCode: 0,
        output: 'LoadState=loaded\nActiveState=failed\nExecMainStatus=3\nExecMainExitTimestamp=Thu',
      }),
    })
    stopped.files.set(UNIT, '')
    await stopped.run('service', 'status')
    expect(stopped.lines[0]).toContain('Running:     no\nLast exit:   code 3 at Thu')
    const unloaded = world({ process: () => ({ exitCode: 0, output: 'LoadState=not-found' }) })
    unloaded.files.set(UNIT, '')
    await unloaded.run('service', 'status')
    expect(unloaded.lines[0]).toContain('Running:     no, not loaded')
    expect(AGENT_FILE).toContain('.config/homingbird')
  })
})

describe('homingbird service uninstall', () => {
  it('stops and disables the service, removes its file, and keeps the log', async () => {
    const w = world()
    await w.run('service', 'install', '--server', SERVER, '--agent', 'claude')
    w.processRuns.length = 0
    expect(await w.run('service', 'uninstall', '--server', SERVER)).toBe(0)
    expect(w.processRuns).toEqual([
      ['systemctl', '--user', 'disable', '--now', 'homingbird-runner-https-hb-example-com.service'],
      ['systemctl', '--user', 'daemon-reload'],
      ['systemctl', '--user', 'reset-failed', 'homingbird-runner-https-hb-example-com.service'],
    ])
    expect(w.files.has(UNIT)).toBe(false)
    expect(w.files.has(LOG)).toBe(true)
    expect(w.lines.at(-1)).toBe(
      `Uninstalled homingbird-runner-https-hb-example-com.service. Its log stays at ${LOG}.`,
    )
  })

  it('succeeds when nothing was installed, even if the service manager complains', async () => {
    const w = world({ process: () => ({ exitCode: 5, output: 'Unit not loaded.' }) })
    expect(await w.run('service', 'uninstall', '--server', SERVER)).toBe(0)
    expect(w.lines[0]).toBe(`No service was installed for ${SERVER}.`)
  })
})

describe('homingbird service stop', () => {
  it('stops the systemd unit until the next login, leaving it installed', async () => {
    const w = world()
    expect(await w.run('service', 'stop', '--server', SERVER)).toBe(0)
    expect(w.processRuns).toEqual([
      ['systemctl', '--user', 'stop', 'homingbird-runner-https-hb-example-com.service'],
    ])
    expect(w.lines[0]).toBe(
      'Stopped homingbird-runner-https-hb-example-com.service. It starts again when you next log in.',
    )
  })
})

describe('the service on Windows', () => {
  const VALUE = 'Homingbird Runner https-hb-example-com'
  const LOCK = `${HOME}/.config/homingbird/desks/service-https-hb-example-com.lock`
  const STOP = `${HOME}/.config/homingbird/desks/service-https-hb-example-com.stop`
  const windows = (options: Parameters<typeof world>[0] = {}) =>
    world({
      platform: 'win32',
      userId: null,
      variables: { USERNAME: 'june', USERDOMAIN: 'EXAMPLE' },
      ...options,
    })
  const holdLock = (w: ReturnType<typeof world>) =>
    w.files.set(LOCK, JSON.stringify({ holder: 'running', heartbeatAt: w.clock.now() }))

  it('writes a value under the person’s Run key and starts the runner, writing no service file', async () => {
    const w = windows()
    expect(await w.run('service', 'install', '--server', SERVER, '--agent', 'claude')).toBe(0)
    const [add, start] = w.processRuns
    expect(add!.slice(0, 7)).toEqual(['reg', 'add', RUN_KEY, '/v', VALUE, '/t', 'REG_SZ'])
    expect(add![7]).toBe('/d')
    expect(add![8]).toContain(
      '"run" "--service" "--server" "https://hb.example.com" "--agent" "claude" "--log"',
    )
    expect(add![8]).toContain('"--workdir" "\\home\\june"')
    expect(add![9]).toBe('/f')
    expect(start!.slice(0, 4)).toEqual([
      '/usr/bin/node',
      '/usr/lib/node_modules/@homingbird/cli/dist/homingbird.js',
      'run',
      '--service',
    ])
    expect(w.ownerOnlyWrites).toEqual([])
    expect(w.lines[0]).toContain(`Definition:  ${RUN_KEY}\\${VALUE}`)
  })

  it('stops a runner already running before it starts the new one', async () => {
    const w = windows()
    holdLock(w)
    const installing = w.run('service', 'install', '--server', SERVER, '--agent', 'claude')
    for (let turn = 0; turn < 50 && !w.files.has(STOP); turn++) await w.clock.advance(1)
    expect(w.files.has(STOP)).toBe(true)
    w.files.delete(LOCK)
    await w.clock.advance(STOP_POLL_MS)
    expect(await installing).toBe(0)
    expect(w.files.has(STOP)).toBe(false)
    expect(w.processRuns.map((run) => run[0])).toEqual(['reg', '/usr/bin/node'])
  })

  it('reports installed from the Run value and running from the runner’s lock, reading no translated output', async () => {
    const w = windows({ process: (program) => (program === 'reg' ? { exitCode: 0, output: '' } : undefined) })
    holdLock(w)
    await w.run('service', 'status', '--json')
    expect(w.json()).toMatchObject({ installed: true, running: true })
    expect(w.processRuns).toEqual([['reg', 'query', RUN_KEY, '/v', VALUE]])
    await w.clock.advance(DESK_CLAIM_STALE_MS)
    await w.run('service', 'status')
    expect(w.lines.at(-1)).toContain('Running:     no')
    expect(w.lines.at(-1)).not.toContain('Last exit')
    const absent = windows({
      process: () => ({
        exitCode: 1,
        output: 'ERROR: The system was unable to find the specified registry key or value.',
      }),
    })
    await absent.run('service', 'status', '--json')
    expect(absent.json()).toMatchObject({ installed: false, running: false })
  })

  it('stops through the stop file, and says so when the runner does not stop in time', async () => {
    const w = windows()
    expect(await w.run('service', 'stop', '--server', SERVER)).toBe(0)
    expect(w.lines[0]).toBe(`${VALUE} was not running.`)
    holdLock(w)
    const stopping = w.run('service', 'stop', '--server', SERVER)
    for (let turn = 0; turn < 100; turn++) await w.clock.advance(STOP_POLL_MS)
    expect(await stopping).toBe(0)
    expect(w.lines.at(-1)).toContain('it has not stopped yet')
  })

  it('deletes the Run value on uninstall, then asks the runner to stop', async () => {
    const w = windows({
      process: (program, args) => (args[0] === 'query' ? { exitCode: 0, output: '' } : undefined),
    })
    holdLock(w)
    const removing = w.run('service', 'uninstall', '--server', SERVER)
    for (let turn = 0; turn < 50 && !w.files.has(STOP); turn++) await w.clock.advance(1)
    w.files.delete(LOCK)
    await w.clock.advance(STOP_POLL_MS)
    expect(await removing).toBe(0)
    expect(w.processRuns.slice(-1)).toEqual([['reg', 'delete', RUN_KEY, '/v', VALUE, '/f']])
    expect(w.lines.at(-1)).toContain(`Uninstalled ${VALUE}.`)
  })

  it('refuses to install as SYSTEM or a machine account', async () => {
    for (const USERNAME of ['SYSTEM', 'LAPTOP42$']) {
      const w = windows({ variables: { USERNAME, USERDOMAIN: 'EXAMPLE' } })
      expect(await w.run('service', 'install', '--server', SERVER, '--agent', 'claude')).toBe(EXIT.usage)
      expect(w.problems).toEqual([AS_THE_PERSON_ON_WINDOWS])
      expect(w.processRuns).toEqual([])
    }
  })
})

describe('homingbird service with a credentials file', () => {
  const FILE = '/run/secrets/homingbird.json'
  const FILE_TOKEN = 'hba_mounted-secret-token-0123456789ab'
  const mounted = { [FILE]: JSON.stringify({ serverUrl: SERVER, token: FILE_TOKEN }) }

  it('names the file in the systemd unit’s environment, never on its command line, and never its content', async () => {
    const w = world({ signedIn: 'none', files: mounted, variables: { PATH: '/usr/bin' } })
    expect(
      await w.run('service', 'install', '--server', SERVER, '--agent', 'claude', '--credentials-file', FILE),
    ).toBe(0)
    const unit = w.files.get(UNIT)!
    expect(unit).toContain(`Environment="HOMINGBIRD_CREDENTIALS_FILE=${FILE}"`)
    expect(unit).toContain('Environment="PATH=/usr/bin"')
    expect(unit.split('\n').find((line) => line.startsWith('ExecStart='))).not.toContain(FILE)
    expect(unit).not.toContain('--credentials-file')
    expect(unit).not.toContain(FILE_TOKEN)
    expect(w.lines[0]).toContain(`Credential:  read from ${FILE}`)
    expect(w.lines[0]).not.toContain('Sign in first')
    expect(w.files.get(FILE)).toBe(mounted[FILE])
    expect(w.ownerOnlyWrites).toEqual([UNIT])
  })

  it('takes the file from HOMINGBIRD_CREDENTIALS_FILE, and the server from the file when none is named', async () => {
    const w = world({ signedIn: 'none', files: mounted, variables: { HOMINGBIRD_CREDENTIALS_FILE: FILE } })
    expect(await w.run('service', 'install', '--agent', 'claude', '--json')).toBe(0)
    expect(w.json()).toMatchObject({ installed: true, server: SERVER, signedIn: true, credentialsFile: FILE })
    expect(w.files.get(UNIT)).toContain(`Environment="HOMINGBIRD_CREDENTIALS_FILE=${FILE}"`)
  })

  it('installs before the file is there, and says what the service waits for', async () => {
    const w = world({ signedIn: 'none' })
    expect(
      await w.run('service', 'install', '--server', SERVER, '--agent', 'claude', '--credentials-file', FILE),
    ).toBe(0)
    expect(w.lines[0]).toContain(
      `The service waits until it can use the credentials file. The credentials file ${FILE} does not exist. Create it on a computer where you can approve the sign-in: homingbird login --server ${SERVER} --credentials-file ${FILE}`,
    )
    const status = world({ signedIn: 'none', files: { [FILE]: '{}' } })
    expect(await status.run('service', 'status', '--server', SERVER, '--credentials-file', FILE)).toBe(0)
    expect(status.lines[0]).toContain(
      `The credentials file ${FILE} does not hold an agent credential. Create it on a computer where you can approve the sign-in: homingbird login --server ${SERVER} --credentials-file ${FILE}`,
    )
    const fine = world({ signedIn: 'none', files: mounted })
    await fine.run('service', 'status', '--server', SERVER, '--credentials-file', FILE, '--json')
    expect(fine.json()).toMatchObject({ signedIn: true })
  })

  it('refuses a relative path, and a missing file when it must name the server', async () => {
    const w = world({ files: { 'homingbird.json': mounted[FILE] } })
    expect(
      await w.run(
        'service',
        'install',
        '--server',
        SERVER,
        '--agent',
        'claude',
        '--credentials-file',
        'homingbird.json',
      ),
    ).toBe(EXIT.usage)
    expect(w.problems).toEqual(['--credentials-file needs an absolute path for the service.'])
    expect(w.processRuns).toEqual([])
    expect(await w.run('service', 'install', '--agent', 'claude', '--credentials-file', FILE)).toBe(
      EXIT.signedOut,
    )
    expect(w.processRuns).toEqual([])
  })

  it('puts the file in the launchd agent’s environment', async () => {
    const w = world({ platform: 'darwin', userId: 501, files: mounted, variables: { PATH: '/usr/bin' } })
    expect(
      await w.run('service', 'install', '--server', SERVER, '--agent', 'claude', '--credentials-file', FILE),
    ).toBe(0)
    const plist = w.files.get(PLIST)!
    expect(plist).toContain(
      [
        '  <key>EnvironmentVariables</key>',
        '  <dict>',
        '    <key>PATH</key>',
        '    <string>/usr/bin</string>',
        '    <key>HOMINGBIRD_CREDENTIALS_FILE</key>',
        `    <string>${FILE}</string>`,
        '  </dict>',
      ].join('\n'),
    )
    expect(plist).not.toContain('--credentials-file')
    expect(plist).not.toContain(FILE_TOKEN)
  })

  it('passes the file to the Windows runner as an option, the only place a Run key can hold it', async () => {
    const path = 'C:\\secrets\\homingbird.json'
    const w = world({
      platform: 'win32',
      userId: null,
      variables: { USERNAME: 'june' },
      files: { [path]: mounted[FILE] },
    })
    expect(
      await w.run('service', 'install', '--server', SERVER, '--agent', 'claude', '--credentials-file', path),
    ).toBe(0)
    const [add, start] = w.processRuns
    expect(add![8]).toContain(`"--credentials-file" "${path}"`)
    expect(add![8]).not.toContain(FILE_TOKEN)
    expect(start).toContain(path)
  })
})
