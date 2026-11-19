import { describe, expect, it } from 'vitest'
import { AS_THE_PERSON, STEP_RETRY_MS, STOP_POLL_MS } from '../src/commands/service.ts'
import { DESK_CLAIM_STALE_MS } from '../src/desk-claim.ts'
import { EXIT } from '../src/failure.ts'
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
      `Sign in first: homingbird login --server ${SERVER}. Until then the service waits.`,
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
