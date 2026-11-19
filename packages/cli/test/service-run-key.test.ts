import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  AS_THE_PERSON_ON_WINDOWS,
  RUN_KEY,
  runKeyService,
  valueName,
  windowsArgument,
  windowsPath,
} from '../src/service-run-key.ts'
import { SPEC, WINDOWS_PLACE, WINDOWS_SPEC } from './service-fixtures.ts'

const paths = runKeyService.place(WINDOWS_PLACE, SPEC.server)

const commandLine = (spec = WINDOWS_SPEC): string => {
  const written = runKeyService.definition(paths, spec)
  if (written._tag === 'Err') throw new Error(written.error)
  return written.value
}

/** The words a Microsoft C runtime program receives, for quoted words without `"`. */
const wordsOf = (line: string): string[] =>
  [...line.matchAll(/"([^"]*)"/g)].map((match) =>
    match[1]!.replace(/(\\+)$/, (run) => run.slice(run.length / 2)),
  )

const RUNNER_WORDS = [
  ...WINDOWS_SPEC.program,
  'run',
  '--service',
  '--server',
  SPEC.server,
  '--agent',
  'claude',
  '--log',
  'C:\\Users\\june\\.config\\homingbird\\logs\\runner-https-hb-example-com.log',
  '--workdir',
  'C:\\Users\\june',
]

describe('the Run key entry', () => {
  it('is a value named after the server under the person’s own Run key, with the lock beside the desk claims', () => {
    expect(paths).toEqual({
      name: 'Homingbird Runner https-hb-example-com',
      definitionPath: `${RUN_KEY}\\Homingbird Runner https-hb-example-com`,
      logPath: 'C:\\Users\\june\\.config\\homingbird\\logs\\runner-https-hb-example-com.log',
      lockPath: 'C:\\Users\\june/.config/homingbird/desks/service-https-hb-example-com.lock',
      stopPath: 'C:\\Users\\june/.config/homingbird/desks/service-https-hb-example-com.stop',
      userId: null,
      windowsUser: 'EXAMPLE\\june',
      server: SPEC.server,
    })
    expect(RUN_KEY).toBe('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run')
    expect(valueName('http://localhost:8080')).toBe('Homingbird Runner http-localhost-8080')
    expect(windowsPath('C:/a/b')).toBe('C:\\a\\b')
    expect(runKeyService.writesFile).toBe(false)
    expect(runKeyService.stopsThroughRunner).toBe(true)
  })

  it('runs Node itself with the runner writing its own log in the working directory', () => {
    expect(wordsOf(commandLine())).toEqual(RUNNER_WORDS)
    expect(commandLine()).not.toContain('cmd.exe')
  })

  it('passes every word to the runner unchanged, trailing backslashes included', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((text) => !/[\p{Cc}"%]/u.test(text)),
        (agent) => {
          expect(wordsOf(commandLine({ ...WINDOWS_SPEC, agent })).at(-5)).toBe(agent)
        },
      ),
    )
    expect(windowsArgument('C:\\dir\\')).toBe('"C:\\dir\\\\"')
  })

  it('refuses a double quote or a percent sign, which the command line could not hold as they are', () => {
    for (const agent of ['claude -p --model "opus"', 'claude 100%'])
      expect(runKeyService.definition(paths, { ...WINDOWS_SPEC, agent })).toMatchObject({
        _tag: 'Err',
        error: expect.stringContaining('" or %'),
      })
    expect(
      runKeyService.definition(paths, { ...WINDOWS_SPEC, credentialsFile: 'C:\\100%\\secret.json' }),
    ).toMatchObject({ _tag: 'Err' })
  })

  it('hands the runner the credentials file’s path as an option, since a Run key sets no variable', () => {
    const credentialsFile = 'C:\\secrets\\homingbird.json'
    expect(wordsOf(commandLine({ ...WINDOWS_SPEC, credentialsFile })).slice(-2)).toEqual([
      '--credentials-file',
      credentialsFile,
    ])
  })

  it('refuses when it cannot tell the Windows user, or when that user is SYSTEM or a machine account', () => {
    const as = (windowsUser: string | null) =>
      runKeyService.definition(
        runKeyService.place({ ...WINDOWS_PLACE, windowsUser }, SPEC.server),
        WINDOWS_SPEC,
      )
    expect(as(null)).toMatchObject({ _tag: 'Err', error: expect.stringContaining('USERNAME') })
    for (const account of ['NT AUTHORITY\\SYSTEM', 'system', 'EXAMPLE\\LAPTOP42$'])
      expect(as(account)).toEqual({ _tag: 'Err', error: AS_THE_PERSON_ON_WINDOWS })
    expect(as('EXAMPLE\\june')._tag).toBe('Ok')
  })

  it('is written with reg.exe and started at once; uninstalling deletes the value', () => {
    const words = (steps: ReadonlyArray<{ program: string; args: ReadonlyArray<string> }>) =>
      steps.map((step) => [step.program, ...step.args])
    const definition = commandLine()
    expect(words(runKeyService.install(paths, definition, WINDOWS_SPEC))).toEqual([
      ['reg', 'add', RUN_KEY, '/v', paths.name, '/t', 'REG_SZ', '/d', definition, '/f'],
      RUNNER_WORDS,
    ])
    expect(words(runKeyService.stop(paths))).toEqual([['reg', 'delete', RUN_KEY, '/v', paths.name, '/f']])
    expect(runKeyService.stop(paths)[0]!.mayFail).toBe(true)
    expect(runKeyService.stopNow(paths)).toEqual([])
    expect(runKeyService.afterRemoval(paths)).toEqual([])
  })

  it('is installed when reg query finds the value, judged by its exit status alone', () => {
    expect(runKeyService.status(paths)).toMatchObject({
      program: 'reg',
      args: ['query', RUN_KEY, '/v', paths.name],
      mayFail: true,
    })
    expect(runKeyService.stateIn({ exitCode: 0, output: 'anything, in any language' })).toEqual({
      loaded: true,
      running: false,
      lastExit: null,
    })
    expect(runKeyService.stateIn({ exitCode: 1, output: '' }).loaded).toBe(false)
  })
})
