import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { labelFor, launchdAgent } from '../src/service-launchd.ts'
import { MAC_PLACE, SPEC, SPLIT_SPEC, unescapeXml } from './service-fixtures.ts'

const paths = launchdAgent.place(MAC_PLACE, SPEC.server)

const plist = (spec = SPEC): string => {
  const written = launchdAgent.definition(paths, spec)
  if (written._tag === 'Err') throw new Error(written.error)
  return written.value
}

const programArguments = (file: string): string[] =>
  [
    .../<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/
      .exec(file)![1]!
      .matchAll(/<string>(.*?)<\/string>/g),
  ].map((match) => unescapeXml(match[1]!))

describe('the launchd user agent', () => {
  it('lives in the person’s own LaunchAgents, labelled after the server', () => {
    expect(paths).toMatchObject({
      name: 'homingbird.runner.https-hb-example-com',
      definitionPath: '/Users/june/Library/LaunchAgents/homingbird.runner.https-hb-example-com.plist',
      logPath: '/Users/june/.config/homingbird/logs/runner-https-hb-example-com.log',
    })
    expect(labelFor('https://hb.example.com/team/')).toBe('homingbird.runner.https-hb-example-com-team')
  })

  it('runs at load, is kept alive, and writes both outputs to the log', async () => {
    await expect(plist()).toMatchFileSnapshot('__snapshots__/homingbird.runner.plist')
    await expect(plist(SPLIT_SPEC)).toMatchFileSnapshot('__snapshots__/homingbird.runner-split.plist')
  })

  it('gives every argument back unchanged, whatever it holds', () => {
    fc.assert(
      fc.property(
        fc.string().filter((text) => !/\p{Cc}/u.test(text)),
        (agent) => {
          expect(programArguments(plist({ ...SPEC, agent })).at(-1)).toBe(agent)
        },
      ),
    )
  })

  it('is loaded into the person’s GUI session, never the system domain', () => {
    const words = (steps: ReadonlyArray<{ program: string; args: ReadonlyArray<string> }>) =>
      steps.map((step) => [step.program, ...step.args].join(' '))
    expect(words(launchdAgent.install(paths, '', SPEC))).toEqual([
      'launchctl bootout gui/501/homingbird.runner.https-hb-example-com',
      'launchctl enable gui/501/homingbird.runner.https-hb-example-com',
      'launchctl bootstrap gui/501 /Users/june/Library/LaunchAgents/homingbird.runner.https-hb-example-com.plist',
    ])
    expect(launchdAgent.install(paths, '', SPEC).map((step) => step.mayFail)).toEqual([true, false, false])
    expect(launchdAgent.install(paths, '', SPEC).map((step) => step.attempts)).toEqual([1, 1, 5])
    expect(words(launchdAgent.stop(paths))).toEqual([
      'launchctl bootout gui/501/homingbird.runner.https-hb-example-com',
    ])
    expect(launchdAgent.afterRemoval(paths)).toEqual([])
    expect(words([launchdAgent.status(paths)])).toEqual([
      'launchctl print gui/501/homingbird.runner.https-hb-example-com',
    ])
  })

  it('reads the state and last exit code that launchctl print shows', () => {
    expect(
      launchdAgent.stateIn({
        exitCode: 0,
        output: '\tstate = running\n\tpid = 42\n\tlast exit code = (never exited)\n',
      }),
    ).toEqual({ loaded: true, running: true, lastExit: null })
    expect(
      launchdAgent.stateIn({ exitCode: 0, output: '\tstate = waiting\n\tlast exit code = 78: EX_CONFIG\n' }),
    ).toEqual({
      loaded: true,
      running: false,
      lastExit: 'code 78: EX_CONFIG',
    })
    expect(launchdAgent.stateIn({ exitCode: 113, output: 'Could not find service' })).toEqual({
      loaded: false,
      running: false,
      lastExit: null,
    })
  })

  it('refuses a value with a control character', () => {
    expect(launchdAgent.definition(paths, { ...SPEC, workdir: '/tmp/\u0000' })._tag).toBe('Err')
  })
})
