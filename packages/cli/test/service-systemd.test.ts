import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { systemdUserService, unitName } from '../src/service-systemd.ts'
import { PLACE, SPEC, SPLIT_SPEC } from './service-fixtures.ts'

const paths = systemdUserService.place(PLACE, SPEC.server)

const unit = (spec = SPEC): string => {
  const written = systemdUserService.definition(paths, spec)
  if (written._tag === 'Err') throw new Error(written.error)
  return written.value
}

/** The words of an ExecStart line as systemd reads them: quoted, with C escapes, `%%` and `$$`. */
const execWords = (file: string): string[] => {
  const line = file
    .split('\n')
    .find((each) => each.startsWith('ExecStart='))!
    .slice('ExecStart='.length)
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) =>
    match[1]!.replace(/\\(.)/g, '$1').replace(/%%/g, '%').replace(/\$\$/g, '$'),
  )
}

describe('the systemd user service', () => {
  it('is a user unit named after the server, under the person’s own systemd directory', () => {
    expect(paths).toEqual({
      name: 'homingbird-runner-https-hb-example-com.service',
      definitionPath: '/home/june/.config/systemd/user/homingbird-runner-https-hb-example-com.service',
      logPath: '/home/june/.config/homingbird/logs/runner-https-hb-example-com.log',
      lockPath: '/home/june/.config/homingbird/desks/service-https-hb-example-com.lock',
      stopPath: '/home/june/.config/homingbird/desks/service-https-hb-example-com.stop',
      userId: 501,
      windowsUser: null,
      server: SPEC.server,
    })
    expect(unitName('http://localhost:8080/')).toBe('homingbird-runner-http-localhost-8080.service')
  })

  it('starts the runner at login, restarts it, and appends its output to the log', async () => {
    await expect(unit()).toMatchFileSnapshot('__snapshots__/homingbird-runner.service')
    await expect(unit(SPLIT_SPEC)).toMatchFileSnapshot('__snapshots__/homingbird-runner-split.service')
  })

  it('gives every word of the command back unchanged, whatever it holds', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme' }).filter((text) => !/\p{Cc}/u.test(text)),
        (agent) => {
          const words = execWords(unit({ ...SPEC, agent }))
          expect(words[words.indexOf('--agent') + 1]).toBe(agent)
          expect(words.slice(-2)).toEqual([
            '--log',
            '/home/june/.config/homingbird/logs/runner-https-hb-example-com.log',
          ])
        },
      ),
    )
    expect(execWords(unit(SPLIT_SPEC))).toEqual([
      ...SPLIT_SPEC.program,
      'run',
      '--service',
      '--server',
      SPEC.server,
      '--agent',
      SPLIT_SPEC.agent,
      '--timeout',
      '120',
      '--split',
      '--reader',
      SPLIT_SPEC.reader,
      '--require-toolless-reader',
      '--log',
      '/home/june/.config/homingbird/logs/runner-https-hb-example-com.log',
    ])
  })

  it('sets the credentials file as a variable that reads back unchanged, whatever the path holds', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((text) => !/\p{Cc}/u.test(text)),
        (credentialsFile) => {
          const line = unit({ ...SPEC, credentialsFile })
            .split('\n')
            .find((each) => each.startsWith('Environment="HOMINGBIRD_CREDENTIALS_FILE='))!
          const value = /^Environment="(.*)"$/.exec(line)![1]!.replace(/\\(.)/g, '$1').replace(/%%/g, '%')
          expect(value).toBe(`HOMINGBIRD_CREDENTIALS_FILE=${credentialsFile}`)
          expect(execWords(unit({ ...SPEC, credentialsFile }))).not.toContain(credentialsFile)
        },
      ),
    )
  })

  it('refuses a value with a line break, which would end the setting', () => {
    expect(
      systemdUserService.definition(paths, { ...SPEC, agent: 'claude\nExecStartPre=/bin/evil' }),
    ).toMatchObject({
      _tag: 'Err',
    })
  })

  it('is loaded, enabled and restarted through systemctl --user, and stopped the same way', () => {
    const words = (steps: ReadonlyArray<{ program: string; args: ReadonlyArray<string> }>) =>
      steps.map((step) => [step.program, ...step.args].join(' '))
    expect(words(systemdUserService.install(paths, '', SPEC))).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable homingbird-runner-https-hb-example-com.service',
      'systemctl --user restart homingbird-runner-https-hb-example-com.service',
    ])
    expect(words(systemdUserService.stop(paths))).toEqual([
      'systemctl --user disable --now homingbird-runner-https-hb-example-com.service',
    ])
    expect(systemdUserService.stop(paths).every((step) => step.mayFail)).toBe(true)
    expect(words(systemdUserService.afterRemoval(paths))).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user reset-failed homingbird-runner-https-hb-example-com.service',
    ])
    expect(words([systemdUserService.status(paths)])).toEqual([
      'systemctl --user show homingbird-runner-https-hb-example-com.service --property=LoadState,ActiveState,SubState,ExecMainStatus,ExecMainExitTimestamp',
    ])
  })

  it('reads whether the unit is loaded and running, and how it last exited', () => {
    expect(
      systemdUserService.stateIn({
        exitCode: 0,
        output:
          'LoadState=loaded\nActiveState=active\nSubState=running\nExecMainStatus=0\nExecMainExitTimestamp=\n',
      }),
    ).toEqual({ loaded: true, running: true, lastExit: null })
    expect(
      systemdUserService.stateIn({
        exitCode: 0,
        output:
          'LoadState=loaded\nActiveState=activating\nExecMainStatus=1\nExecMainExitTimestamp=Thu 2026-11-19 09:00:00 UTC\n',
      }),
    ).toEqual({ loaded: true, running: false, lastExit: 'code 1 at Thu 2026-11-19 09:00:00 UTC' })
    expect(
      systemdUserService.stateIn({ exitCode: 0, output: 'LoadState=not-found\nActiveState=inactive' }),
    ).toEqual({ loaded: false, running: false, lastExit: null })
    expect(systemdUserService.stateIn({ exitCode: 1, output: 'Failed to connect to bus' })).toEqual({
      loaded: false,
      running: false,
      lastExit: null,
    })
    expect(
      systemdUserService.stateIn({ exitCode: 0, output: 'ExecMainExitTimestamp=yesterday' }).lastExit,
    ).toBe('code unknown at yesterday')
  })
})
